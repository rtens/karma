const crypto = require('crypto');

//------ DOMAIN -------//

class BaseModule {
  constructor(eventLog, snapshotStore, repositoryStrategy, eventStore) {
    this._log = eventLog;

    this._aggregates = new AggregateRepository(eventLog, snapshotStore, repositoryStrategy, eventStore);
    this._projections = new ProjectionRepository(eventLog, snapshotStore, repositoryStrategy);
    this._subscriptions = new SubscriptionRepository(eventLog, snapshotStore, repositoryStrategy);
  }

  add(unit) {
    switch (unit.constructor.name) {
      case Aggregate.name:
        this._aggregates.add(unit);
        break;
      case Projection.name:
        this._projections.add(unit);
        this._subscriptions.add(unit);
        break;
    }
    return this
  }

  execute(command) {
    return this._aggregates
      .getInstance(command)
      .then(instance => instance.execute(command))
      .then(() => this)
  }

  respondTo(query) {
    return this._projections
      .getInstance(query)
      .then(instance => instance.respondTo(query))
  }

  subscribeTo(query, subscriber) {
    return this._subscriptions
      .getInstance(query)
      .then(instance => instance.subscribeTo(query, subscriber))
  }
}

class Module extends BaseModule {
  constructor(eventLog, snapshotStore, repositoryStrategy, eventStore) {
    super(eventLog, snapshotStore, repositoryStrategy, eventStore);

    this._meta = new BaseModule(eventLog, snapshotStore, repositoryStrategy, eventStore);
    this._sagas = new SagaRepository(eventLog, snapshotStore, repositoryStrategy, this._meta);

    this._subscription = null;
    this._meta._aggregates.add(new SagaLockAggregate());
    this._meta._aggregates.add(new SagaFailuresAggregate());
    this._meta._projections.add(new SagaReactionHeadsProjection());
  }

  add(unit) {
    switch (unit.constructor.name) {
      case Saga.name:
        this._sagas.add(unit);
        break;
      default:
        super.add(unit)
    }
    return this
  }

  start() {
    return this._meta.respondTo(new Query('_saga-reaction-heads'))
      .then(heads => {
        debug('subscribe module', {heads});
        return this._log.subscribe(heads, record => this.reactTo(record))
      })
      .then(subscription => this._subscription = subscription)
      .then(() => this)
  }

  reactTo(record) {
    return this._sagas
      .getInstances(record.event)
      .then(instances => Promise.all(instances.map(instance => instance.reactTo(record))))
  }
}

class Message {
  constructor(name, payload) {
    this.name = name;
    this.payload = payload;
  }
}

class Command extends Message {
  constructor(name, payload, traceId) {
    super(name, payload);
    this.traceId = traceId;
  }
}

class Query extends Message {
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

class EventLog {
  //noinspection JSUnusedLocalSymbols
  subscribe(streamHeads, subscriber) {
    return Promise.resolve({cancel: () => null})
  }
}

class EventStore {
  //noinspection JSUnusedLocalSymbols
  record(events, streamId, onSequence, traceId) {
    return Promise.resolve()
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
  }

  mapToId(message) {
    return this._mappers[message.name](message.payload);
  }

  withVersion(version) {
    this._version = version;
    return this
  }

  get version() {
    return this._version = this._version || this._inferVersion();
  }

  _inferVersion() {
    var fingerprint = JSON.stringify([
      Object.values(this._appliers).map(as => as.map(a => a.toString())),
      Object.values(this._initializers).map(i => i.toString())
    ]);

    return crypto.createHash('md5').update(fingerprint).digest('hex');
  }

  initializing(initializer) {
    this._initializers.push(initializer);
    return this
  }

  applying(eventName, applier) {
    (this._appliers[eventName] = this._appliers[eventName] || []).push(applier);
    return this
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

    this._loading = false;
    this._loaded = false;
    this._onLoad = [];

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
    if (this._loading) return new Promise(y => this._onLoad.push(y));
    this._loading = true;

    return Promise.resolve()
      .then(() => this._loadSnapshot())
      .then(() => this._subscribeToLog())
      .then(() => this._loadingFinished())
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

  _loadingFinished() {
    this._loaded = true;
    this._onLoad.forEach(l => l(this));
  }

  unload() {
    debug('unload', {key: this._key});
    this._loaded = false;
    this._subscription.cancel();
  }

  takeSnapshot() {
    debug('store', {key: this._key, version: this._definition.version, heads: this._heads});
    this._snapshots.store(this._key, this._definition.version, new Snapshot(this._heads, this._state));
  }

  apply(record) {
    debug('apply', {key: this._key, heads: this._heads, record});
    if (record.sequence <= this._heads[record.streamId]) return;

    (this._definition._appliers[record.event.name] || []).forEach(applier =>
      applier.call(this._state, record.event.payload, record));

    this._heads[record.streamId] = record.sequence;
  }
}

class UnitRepository {
  constructor(log, snapshots, strategy) {
    this._log = log;
    this._snapshots = snapshots;
    this._strategy = strategy;

    this._definitions = [];
    this._instances = {};
  }

  add(definition) {
    this._definitions.push(definition);
  }

  getInstances(message) {
    return Promise.all(this._getHandlersFor(message).map(unitDefinition => {

      var unitId = unitDefinition.mapToId(message);
      if (!unitId) {
        throw new Error(`Cannot map [${message.name}]`)
      }

      return this._getOrLoad(unitDefinition, unitId)
    }))
  }

  _getHandlersFor(message) {
    return this._definitions.filter(d => d.canHandle(message));
  }

  _getOrLoad(definition, unitId) {
    this._instances[definition.name] = this._instances[definition.name] || {};

    if (!this._instances[definition.name][unitId]) {
      debug('load', {name: definition.name, id: unitId});
      this._instances[definition.name][unitId] = this._createInstance(definition, unitId);
    }

    let instance = this._instances[definition.name][unitId];
    return instance.load()
      .then(() => this._strategy.onAccess(instance, this))
      .then(() => instance)
  }

  _createInstance(definition, unitId) {
  }

  remove(unit) {
    if (this._instances[unit._definition.name]) {
      delete this._instances[unit._definition.name][unit.id];
    }
    unit.unload();
  }
}

class RepositoryStrategy {
  onAccess(unit, repository) {
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
    return super.apply(record);
  }

  execute(command) {
    debug('execute', {command, id: this.id});
    return this._execute(command);
  }

  _execute(command, tries = 0) {
    let events = this._definition._executers[command.name].call(this._state, command.payload);

    if (!Array.isArray(events)) return Promise.resolve();

    debug('record', {id: this.id, triessequence: this._heads[this.id], events});
    return this._store.record(events, this.id, this._heads[this.id], command.traceId)
      .catch(e => {
        if (tries > 3) throw e;
        return this._execute(command, tries + 1)
      })
  }
}

class AggregateRepository extends UnitRepository {
  constructor(log, snapshots, strategy, store) {
    super(log, snapshots, strategy);
    this._store = store;
  }

  getInstance(command) {
    return this.getInstances(command)
      .then(instances => {

        if (instances.length == 0) {
          throw new Error(`Cannot handle Command [${command.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Command [${command.name}]`)
        }

        return instances[0];
      })
  }

  _createInstance(definition, aggregateId) {
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

  respondTo(query) {
    return Promise.resolve(this._definition._responders[query.name].call(this._state, query.payload));
  }
}

class ProjectionRepository extends UnitRepository {
  getInstance(query) {
    return this.getInstances(query)
      .then(instances => {

        if (instances.length == 0) {
          throw new Error(`Cannot handle Query [${query.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Query [${query.name}]`)
        }

        return instances[0];
      })
  }

  _createInstance(definition, projectionId) {
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
  constructor(log, snapshots, strategy) {
    super(log, snapshots, strategy)
  }

  _createInstance(definition, projectionId) {
    return new SubscriptionInstance(projectionId, definition, this._log, this._snapshots);
  }
}

//-------- SAGA -------//

class Saga extends Unit {
  constructor(name) {
    super(name);
    this._reactors = {};

    this.reactingTo('_saga-reaction-retry-requested', $=>$.sagaId);
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
    if (record.event.name == '_saga-reaction-retry-requested') {
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
    return this._meta.execute(new Command('_lock-saga-reaction', {
      sagaKey: this._key,
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
    return this._meta.execute(new Command('_unlock-saga-reaction', {
      sagaKey: this._key,
      streamId: record.streamId,
      sequence: record.sequence
    }))
  }

  _markReactionFailed(record, errors) {
    return this._meta.execute(new Command('_mark-saga-reaction-as-failed', {
      sagaId: this.id,
      sagaKey: this._key,
      record,
      errors
    }))
  }
}

class SagaRepository extends UnitRepository {
  constructor(log, snapshots, strategy, metaModule) {
    super(log, snapshots, strategy);
    this._meta = metaModule;
  }

  _createInstance(definition, sagaId) {
    return new SagaInstance(sagaId, definition, this._log, this._snapshots, this._meta);
  }
}

class SagaLockAggregate extends Aggregate {
  constructor() {
    super('_SagaLock');

    this

      .initializing(function () {
        this.locked = {};
      })

      .executing('_lock-saga-reaction', $=>$.sagaKey, function ({sagaKey, streamId, sequence}) {
        if (this.locked[JSON.stringify({streamId, sequence})]) {
          throw new Error('Reaction locked');
        }
        return [new Event('_saga-reaction-locked', {sagaKey, streamId, sequence})]
      })

      .executing('_unlock-saga-reaction', $=>$.sagaKey, function ({sagaKey, streamId, sequence}) {
        return [new Event('_saga-reaction-unlocked', {sagaKey, streamId, sequence})]
      })

      .applying('_saga-reaction-locked', function ({streamId, sequence}) {
        //noinspection JSUnusedAssignment
        this.locked[JSON.stringify({streamId, sequence})] = true;
      })

      .applying('_saga-reaction-unlocked', function ({streamId, sequence}) {
        delete this.locked[JSON.stringify({streamId, sequence})];
      });
  }
}

class SagaFailuresAggregate extends Aggregate {
  constructor() {
    super('_SagaFailures');

    this.executing('_mark-saga-reaction-as-failed', $=>$.sagaKey, function ({sagaId, sagaKey, record, errors}) {
      return [new Event('_saga-reaction-failed', {sagaId, sagaKey, record, errors})]
    });
  }
}

class SagaReactionHeadsProjection extends Projection {
  constructor() {
    super('_SagaReactionHeads');

    this

      .initializing(function () {
        this.heads = {};
        this.pastHeads = {};
      })

      .applying('_saga-reaction-locked', function ({streamId, sequence}) {
        if (!this.heads[streamId] || this.heads[streamId] == sequence - 1)
          this.heads[streamId] = sequence;

        this.pastHeads[streamId] = this.pastHeads[streamId] || [];
        this.pastHeads[streamId].unshift(sequence)
      })

      .applying('_saga-reaction-unlocked', function ({streamId, sequence}) {
        this.pastHeads[streamId] = this.pastHeads[streamId].filter(s => s < sequence);
        this.heads[streamId] = this.pastHeads[streamId][0]
      })

      .respondingTo('_saga-reaction-heads', $=>'karma', function () {
        return this.heads
      })
  }
}

//------ SNAPSHOT -----//

class SnapshotStore {
  //noinspection JSUnusedLocalSymbols
  store(key, version, snapshot) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  fetch(key, version) {
    return Promise.reject(new Error('No snapshot'))
  }
}

class Snapshot {
  constructor(heads, state) {
    this.heads = heads;
    this.state = state;
  }
}

module.exports = {
  Module,

  Message,
  Command,
  Query,
  Event,

  RepositoryStrategy,
  Aggregate,
  Projection,
  Saga,

  Record,
  EventLog,
  SnapshotStore,
  EventStore,
  Snapshot
};

function debug(tag, message) {
  if (process.env.DEBUG) console.log(tag, JSON.stringify(message));
}