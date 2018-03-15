const crypto = require('crypto');

//------ DOMAIN -------//

class BaseModule {
  constructor(name, unitStrategy, persistenceFactory) {
    this._strategy = unitStrategy;

    this._log = new MultiEventLog().add(persistenceFactory.eventLog(name));
    this._snapshots = persistenceFactory.snapshotStore(name);
    this._store = persistenceFactory.eventStore(name);

    this._aggregates = new AggregateRepository(this._log, this._snapshots, this._store);
    this._projections = new ProjectionRepository(this._log, this._snapshots);
    this._subscriptions = new SubscriptionRepository(this._log, this._snapshots);
  }

  addEventLog(eventLog) {
    this._log.add(eventLog);
    return this;
  }

  add(unit) {
    if (unit instanceof Aggregate) {
      this._aggregates.add(unit);
    } else if (unit instanceof Projection) {
      this._projections.add(unit);
      this._subscriptions.add(unit);
    }

    return this
  }

  execute(command) {
    return this._aggregates
      .getAggregateExecuting(command)
      .then(this._notifyAccess(aggregate =>
        aggregate.execute(command)))
  }

  respondTo(query) {
    return this._projections
      .getProjectionRespondingTo(query)
      .then(this._notifyAccess(projection =>
        projection.respondTo(query)))
  }

  subscribeTo(query, subscriber) {
    return this._subscriptions
      .getSubscriptionRespondingTo(query)
      .then(this._notifyAccess(subscription =>
        subscription.subscribeTo(query, subscriber)))
  }

  _notifyAccess(handler) {
    return instance => handler(instance)
      .then(value => {
        this._strategy.onAccess(instance);
        return value
      })
      .catch(err => {
        this._strategy.onAccess(instance);
        return Promise.reject(err)
      })
  }
}

class Module extends BaseModule {
  constructor(name, unitStrategy, persistenceFactory, metaPersistenceFactory) {
    super(name, unitStrategy, persistenceFactory);
    this._name = name;

    this._log.add(metaPersistenceFactory.eventLog('__admin'));

    this._meta = new BaseModule(name + '__meta', unitStrategy, metaPersistenceFactory);
    this._sagas = new SagaRepository(this._log, this._snapshots, this._meta);

    this._meta._aggregates.add(new ReactionLockAggregate());
    this._meta._aggregates.add(new ReactionFailuresAggregate());
    this._meta._aggregates.add(new StreamHeadsAggregate());
    this._meta._projections.add(new StreamHeadsProjection());
  }

  add(unit) {
    if (unit instanceof Saga) {
      this._sagas.add(unit);
    } else {
      super.add(unit)
    }

    return this
  }

  start() {
    return this._meta.respondTo(new Query('stream-heads'))
      .then(heads => {
        debug('subscribe module', {heads});
        return this._log.subscribe(heads, record => this.reactTo(record))
      })
      .then(() => this)
  }

  reactTo(record) {
    return this._sagas
      .getSagasReactingTo(record.event)
      .then(instances => instances.length
        ? Promise.all(instances.map(this._notifyAccess(instance => instance.reactTo(record))))
        : this._consumeRecord(record))
  }

  _consumeRecord(record) {
    return this._meta.execute(new Command('consume-record', {
      consumerKey: ['__Module', this._name, record.streamId].join('-'),
      streamId: record.streamId,
      sequence: record.sequence
    }));
  }
}

class Message {
  constructor(name, payload) {
    this.name = name;
    this.payload = payload;
  }
}

class Command extends Message {
  withTraceId(traceId) {
    this.traceId = traceId;
    return this
  }
}

class Query extends Message {
  waitFor(heads) {
    this.heads = heads;
    return this
  }
}

//----- EVENTS ------//

class Event extends Message {
  constructor(name, payload, time = new Date()) {
    super(name, payload);
    this.time = time;
  }
}

class Record {
  constructor(event, streamId, sequence, traceId) {
    this.event = event;
    this.streamId = streamId;
    this.sequence = sequence;
    this.traceId = traceId;
  }
}

//--- PERSISTENCE ---//

class EventLog {
  constructor(moduleName) {
    this.module = moduleName;
  }

  //noinspection JSUnusedLocalSymbols
  subscribe(streamHeads, subscriber) {
    return Promise.resolve({cancel: () => null})
  }
}

class MultiEventLog extends EventLog {
  constructor() {
    super();
    this._logs = [];
  }

  add(eventLog) {
    this._logs.push(eventLog);
    return this
  }

  subscribe(streamHeads, subscriber) {
    return Promise.all(this._logs.map(log => log.subscribe(streamHeads, subscriber)))
      .then(subscriptions => ({cancel: () => subscriptions.forEach(s => s.cancel())}))
  }
}

class EventStore {
  constructor(moduleName) {
    this.module = moduleName;
  }

  record(events, streamId, onSequence, traceId) {
    return Promise.resolve(events.map((e, i) =>
      new Record(e, streamId, (onSequence || 0) + 1 + i, traceId)))
  }
}

class PersistenceFactory {
  eventLog(moduleName) {
    return new EventLog(moduleName)
  }

  snapshotStore(moduleName) {
    return new SnapshotStore(moduleName);
  }

  eventStore(moduleName) {
    return new EventStore(moduleName);
  }
}

//------ SNAPSHOT -----//

class Snapshot {
  constructor(heads, state) {
    this.heads = heads;
    this.state = state;
  }
}

class SnapshotStore {
  constructor(moduleName) {
    this.module = moduleName;
  }

  //noinspection JSUnusedLocalSymbols
  store(key, version, snapshot) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  fetch(key, version) {
    return Promise.reject(new Error('No snapshot'))
  }
}

//------- UNIT ---------//

class Unit {
  constructor(name) {
    if (!name) {
      throw new Error('Please provide a name.');
    }

    this.name = name;
    this._version = null;
    this._initializers = [];
    this._appliers = {};
    this._mappers = {};
  }

  canHandle(message) {
    return false
  }

  mapToId(message) {
    return this._mappers[message.name](message.payload);
  }

  initializing(initializer) {
    this._initializers.push(initializer);
    return this
  }

  applying(eventName, applier) {
    (this._appliers[eventName] = this._appliers[eventName] || []).push(applier);
    return this
  }

  get version() {
    return this._version = this._version || this._inferVersion();
  }

  withVersion(version) {
    this._version = version;
    return this
  }

  _inferVersion() {
    var fingerprint = JSON.stringify([
      Object.values(this._appliers).map(as => as.map(a => a.toString())),
      Object.values(this._initializers).map(i => i.toString())
    ]);

    return crypto.createHash('md5').update(fingerprint).digest('hex');
  }
}

class UnitInstance {
  constructor(id, definition, log, snapshots) {
    this.id = id;

    this._definition = definition;
    this._log = log;
    this._snapshots = snapshots;

    this._heads = {};
    this._state = {};
    this._subscription = null;

    this._loaded = false;
    this._loading = false;
    this._onLoad = [];
    this._onUnload = [];

    definition._initializers.forEach(i => i.call(this._state));
  }

  get _key() {
    return [
      this._definition.constructor.name,
      this._definition.name,
      this.id
    ].join('-')
  }

  load() {
    if (this._loaded) return Promise.resolve(this);
    if (this._loading) return new Promise(y => this._onLoad.push(()=>y(this)));
    this._loading = true;

    return Promise.resolve()
      .then(() => this._loadSnapshot())
      .then(() => this._subscribeToLog())
      .then(() => this._finishLoading())
      .then(() => this);
  }

  _loadSnapshot() {
    debug('fetch', {key: this._key, version: this._definition.version});
    return this._snapshots.fetch(this._key, this._definition.version)
      .then(snapshot => {
        debug('fetched', {key: this._key, snapshot});
        this._state = snapshot.state;
        this._heads = snapshot.heads;
      })
      .catch(()=>null)
  }

  _subscribeToLog() {
    debug('subscribe', {key: this._key, heads: this._heads});
    return this._log.subscribe(this._heads, record => this.apply(record))
      .then(subscription => this._subscription = subscription)
  }

  _finishLoading() {
    this._loaded = true;
    this._onLoad.forEach(fn=>fn());
  }

  onUnload(fn) {
    this._onUnload.push(fn);
  }

  unload() {
    debug('unload', {key: this._key});
    this._onUnload.forEach(fn=>fn());
    this._subscription.cancel();
  }

  takeSnapshot() {
    debug('store', {key: this._key, version: this._definition.version, heads: this._heads});
    this._snapshots.store(this._key, this._definition.version, new Snapshot(this._heads, this._state));
  }

  apply(record) {
    let appliers = this._definition._appliers[record.event.name];
    if (!appliers) return;

    if (record.sequence <= this._heads[record.streamId]) return;

    debug('apply', {key: this._key, heads: this._heads, record});
    appliers.forEach(applier => applier.call(this._state, record.event.payload, record));

    this._heads[record.streamId] = record.sequence;
  }
}

class UnitRepository {
  constructor(log, snapshots) {
    this._log = log;
    this._snapshots = snapshots;

    this._definitions = [];
    this._instances = {};
  }

  add(definition) {
    this._definitions.push(definition);
  }

  _getUnitsHandling(message) {
    return Promise.all(this._definitions
      .filter(d => d.canHandle(message))
      .map(unitDefinition => {
        let unitId = unitDefinition.mapToId(message);
        if (!unitId) {
          throw new Error(`Cannot map [${message.name}]`)
        }

        return this._getOrLoad(unitDefinition, unitId)
      }))
  }

  _getOrLoad(definition, unitId) {
    this._instances[definition.name] = this._instances[definition.name] || {};

    let instance = this._instances[definition.name][unitId];

    if (!instance) {
      debug('load', {name: definition.name, id: unitId});
      instance = this._instances[definition.name][unitId] = this._createInstance(unitId, definition);
      instance.onUnload(() => delete this._instances[definition.name][unitId])
    }

    return instance.load()
  }

  _createInstance(unitId, definition) {
    return new UnitInstance(unitId, definition, this._log, this._snapshots);
  }
}

class UnitStrategy {
  onAccess(unit) {
  }
}

//------ AGGREGATE -----//

class Aggregate extends Unit {
  constructor(name) {
    super(name);
    this._executers = {};
  }

  canHandle(command) {
    return command.name in this._executers;
  }

  executing(commandName, mapper, executer) {
    if (commandName in this._executers) {
      throw new Error(`[${this.name}] is already executing [${commandName}]`)
    }

    this._executers[commandName] = executer;
    this._mappers[commandName] = mapper;
    return this
  }
}

class AggregateInstance extends UnitInstance {
  constructor(id, definition, log, snapshots, store) {
    super(id, definition, log, snapshots);
    this._store = store;
  }

  apply(record) {
    if (record.streamId != this.id) return;
    super.apply(record);
    this._heads = {[this.id]: record.sequence};
  }

  execute(command) {
    debug('execute', {command, id: this.id});
    try {
      return this._execute(command);
    } catch (err) {
      return Promise.reject(err)
    }
  }

  _execute(command, tries = 0) {
    let events = this._definition._executers[command.name].call(this._state, command.payload);

    if (!Array.isArray(events)) return Promise.resolve([]);

    debug('record', {id: this.id, tries, sequence: this._heads[this.id], events});
    return this._store.record(events, this.id, this._heads[this.id], command.traceId)
      .catch(e => {
        if (tries >= 10) throw e;
        return new Promise(y => setTimeout(() => y(this._execute(command, tries + 1)),
          Math.round(10 + Math.random() * Math.pow(2, 1 + tries))))
      })
  }
}

class AggregateRepository extends UnitRepository {
  constructor(log, snapshots, store) {
    super(log, snapshots);
    this._store = store;
  }

  getAggregateExecuting(command) {
    return this._getUnitsHandling(command)
      .then(instances => {

        if (instances.length == 0) {
          throw new Error(`Cannot handle Command [${command.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Command [${command.name}]`)
        }

        return instances[0];
      })
  }

  _createInstance(aggregateId, definition) {
    return new AggregateInstance(aggregateId, definition, this._log, this._snapshots, this._store);
  }
}

//----- PROJECTION ----//

class Projection extends Unit {
  constructor(name) {
    super(name);
    this._responders = {};
  }

  canHandle(query) {
    return query.name in this._responders;
  }

  respondingTo(queryName, mapper, responder) {
    if (queryName in this._responders) {
      throw new Error(`[${this.name}] is already responding to [${queryName}]`);
    }
    this._mappers[queryName] = mapper;
    this._responders[queryName] = responder;
    return this;
  }
}

class ProjectionInstance extends UnitInstance {
  constructor(id, definition, log, snapshots) {
    super(id, definition, log, snapshots);
    this._waiters = [];
    this._unloaded = false;
  }

  respondTo(query) {
    return this._waitFor(query.heads)
      .then(() => this._definition._responders[query.name].call(this._state, query.payload));
  }

  _waitFor(heads) {
    return Promise.all(Object.keys(heads || {})
      .filter(streamId => (this._heads[streamId] || 0) < heads[streamId])
      .map(streamId => new Promise(y =>
        this._waiters.push({streamId, sequence: heads[streamId], resolve: y}))))
  }

  apply(record) {
    super.apply(record);

    this._waiters = this._waiters
      .filter(w => w.streamId != record.streamId || w.sequence != record.sequence || w.resolve())
  }

  unload() {
    if (this._waiters.length) return;
    super.unload()
  }
}

class ProjectionRepository extends UnitRepository {
  getProjectionRespondingTo(query) {
    return this._getUnitsHandling(query)
      .then(instances => {

        if (instances.length == 0) {
          throw new Error(`Cannot handle Query [${query.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Query [${query.name}]`)
        }

        return instances[0];
      })
  }

  _createInstance(projectionId, definition) {
    return new ProjectionInstance(projectionId, definition, this._log, this._snapshots);
  }
}

//---- SUBSCRIPTION ---//

class SubscriptionInstance extends ProjectionInstance {
  constructor(id, definition, log, snapshots) {
    super(id, definition, log, snapshots);
    this._subscriptions = [];
    this._unloaded = false;
  }

  _loadSnapshot() {
    return super._loadSnapshot()
      .then(() => this._state = this._proxyState())
      .then(() => this)
  }

  _proxyState() {
    return new Proxy(this._state, {
      ['set']: (target, name, value) => {
        target[name] = value;
        this._subscriptions
          .filter((subscription) => subscription.active)
          .forEach(({query, subscriber}) => this.respondTo(query).then(subscriber));
      }
    });
  }

  subscribeTo(query, subscriber) {
    let subscription = {query, subscriber, active: true};
    this._subscriptions.push(subscription);

    return this.respondTo(query)
      .then(subscriber)
      .then(() => ({
        cancel: () => {
          subscription.active = false;
          if (this._unloaded && this._subscriptions.filter(s=>s.active).length == 0) {
            super.unload()
          }
        }
      }));
  }

  unload() {
    this._unloaded = true;
  }
}

class SubscriptionRepository extends ProjectionRepository {
  getSubscriptionRespondingTo(query) {
    return this.getProjectionRespondingTo(query)
  }

  _createInstance(projectionId, definition) {
    return new SubscriptionInstance(projectionId, definition, this._log, this._snapshots);
  }
}

//-------- SAGA -------//

class Saga extends Unit {
  constructor(name) {
    super(name);
    this._reactors = {};

    this.reactingTo('__reaction-retry-requested', $=>$.sagaId);
  }

  canHandle(event) {
    return event.name in this._reactors;
  }

  reactingTo(eventName, mapper, reactor) {
    if (eventName in this._reactors) {
      throw new Error(`Reaction to [${eventName}] is already defined in [${this.name}]`);
    }
    this._mappers[eventName] = mapper;
    this._reactors[eventName] = reactor;
    return this
  }
}

class SagaInstance extends UnitInstance {
  constructor(id, definition, log, snapshots, meta) {
    super(id, definition, log, snapshots);
    this._meta = meta;
  }

  reactTo(record) {
    if (record.event.name == '__reaction-retry-requested') {
      return this._reactTo(record.event.payload.record, [], 0);
    }

    return this._reactTo(record, [], 4);
  }

  _reactTo(record, errors, triesLeft) {
    debug('reactTo', {key: this._key, record});

    return this._lockReaction(record)
      .then(locked => locked ? this._tryToReactTo(record, errors, triesLeft) : null)
  }

  _tryToReactTo(record, errors, triesLeft) {
    let reactor = this._definition._reactors[record.event.name];

    return new Promise(y => y(reactor.call(this._state, record.event.payload)))
      .catch(err => {
        errors.push(err.stack);
        debug('failed', {key: this._key, record, triesLeft, errors});

        return this._unlockReaction(record)
          .then(() => triesLeft
            ? setTimeout(() => this._reactTo(record, errors, triesLeft - 1), Math.pow(10, errors.length - 1))
            : this._markReactionFailed(record, errors))
      })
  }

  _lockReaction(record) {
    return this._meta.execute(new Command('lock-reaction', {
      sagaKey: '__' + this._key,
      streamId: record.streamId,
      sequence: record.sequence
    }))
      .then(() => true)
      .catch(error => {
        debug('locked', {key: this._key, record, error: error.message});
        return false;
      })
  }

  _unlockReaction(record) {
    return this._meta.execute(new Command('unlock-reaction', {
      sagaKey: '__' + this._key,
      streamId: record.streamId,
      sequence: record.sequence
    }))
  }

  _markReactionFailed(record, errors) {
    return this._meta.execute(new Command('mark-reaction-as-failed', {
      sagaId: this.id,
      sagaKey: '__' + this._key,
      record,
      errors
    }))
  }
}

class SagaRepository extends UnitRepository {
  constructor(log, snapshots, metaModule) {
    super(log, snapshots);
    this._meta = metaModule;
  }

  getSagasReactingTo(event) {
    return this._getUnitsHandling(event);
  }

  _createInstance(sagaId, definition) {
    return new SagaInstance(sagaId, definition, this._log, this._snapshots, this._meta);
  }
}

class ReactionLockAggregate extends Aggregate {
  constructor() {
    super('ReactionLock');

    this

      .initializing(function () {
        this.locked = {};
      })

      .applying('__reaction-locked', function ({streamId, sequence}) {
        //noinspection JSUnusedAssignment
        this.locked[JSON.stringify({streamId, sequence})] = true;
      })

      .applying('__reaction-unlocked', function ({streamId, sequence}) {
        delete this.locked[JSON.stringify({streamId, sequence})];
      })

      .executing('lock-reaction', $=>$.sagaKey, function ({sagaKey, streamId, sequence}) {
        if (this.locked[JSON.stringify({streamId, sequence})]) {
          throw new Error('Reaction locked');
        }
        return [new Event('__reaction-locked', {sagaKey, streamId, sequence})]
      })

      .executing('unlock-reaction', $=>$.sagaKey, function ({sagaKey, streamId, sequence}) {
        return [new Event('__reaction-unlocked', {sagaKey, streamId, sequence})]
      });
  }
}

class ReactionFailuresAggregate extends Aggregate {
  constructor() {
    super('ReactionFailures');

    this.executing('mark-reaction-as-failed', $=>$.sagaKey, function ({sagaId, sagaKey, record, errors}) {
      return [new Event('__reaction-failed', {sagaId, sagaKey, record, errors})]
    });
  }
}

class StreamHeadsAggregate extends Aggregate {
  constructor() {
    super('StreamHeads');

    this.executing('consume-record', $=>$.consumerKey, function ({streamId, sequence}) {
      return [new Event('__record-consumed', {streamId, sequence})]
    })
  }
}

class StreamHeadsProjection extends Projection {
  constructor() {
    super('StreamHeads');

    this

      .initializing(function () {
        this.heads = {};
      })

      .applying('__record-consumed', function ({streamId, sequence}) {
        this.heads[streamId] = this.heads[streamId] || {};
        this.heads[streamId][sequence] = sequence;
      })

      .applying('__reaction-locked', function ({streamId, sequence}) {
        this.heads[streamId] = this.heads[streamId] || {};
        this.heads[streamId][sequence] = sequence;
      })

      .applying('__reaction-unlocked', function ({streamId, sequence}) {
        delete this.heads[streamId][sequence];
      })

      .respondingTo('stream-heads', $=>'karma', function () {
        return Object.keys(this.heads).reduce((heads, streamId) => {
          let lastHead = Object.keys(this.heads[streamId]).pop();
          heads[streamId] = this.heads[streamId][lastHead];
          return heads
        }, {})
      })
  }
}

module.exports = {
  Module,

  Message,
  Command,
  Query,
  Event,

  UnitStrategy,
  Aggregate,
  Projection,
  Saga,

  Record,
  EventLog,
  PersistenceFactory,
  SnapshotStore,
  EventStore,
  Snapshot
};

function debug(tag, message) {
  if (process.env.DEBUG) console.log(tag, JSON.stringify(message));
}