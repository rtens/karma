const crypto = require('crypto');

//------ DOMAIN -------//

class Module {
  constructor(eventLog, snapshotStore, repositoryStrategy, eventStore) {
    this._log = eventLog;
    this._strategy = repositoryStrategy;

    this._aggregates = new AggregateRepository(eventLog, snapshotStore, eventStore);
    this._projections = new ProjectionRepository(eventLog, snapshotStore);
    this._sagas = new SagaRepository(eventLog, snapshotStore, this);

    this._subscription = null;
  }

  add(unit) {
    switch (unit.constructor.name) {
      case Aggregate.name:
        this._aggregates.add(unit);
        break;
      case Projection.name:
        this._projections.add(unit);
        break;
      case Saga.name:
        if (!this._subscription) this._onFirstSaga();
        this._sagas.add(unit);
        break;
    }
    return this
  }

  execute(command) {
    return this._aggregates
      .getInstance(command)
      .then(instance =>
        instance.execute(command)
          .then(() => this._strategy.onAccess(instance, this._aggregates)))
      .then(() => this)
  }

  respondTo(query) {
    return this._projections
      .getInstance(query)
      .then(instance =>
        instance.respondTo(query)
          .then(response => {
            this._strategy.onAccess(instance, this._projections);
            return response
          }))
  }

  subscribeTo(query, subscriber) {
    return this._projections
      .getInstance(query)
      .then(instance =>
        instance.subscribeTo(query, subscriber)
          .then(subscription => {
            this._strategy.onAccess(instance, this._aggregates);
            return subscription;
          }))
  }

  reactTo(record) {
    return this._sagas
      .getInstances(record.event)
      .then(instances => Promise.all(
        instances.map(instance => instance.reactTo(record)))
        // .then(() => this._strategy.onAccess(instance, this._sagas))
      )
      .catch(e => console.error(e.stack))
  }

  _onFirstSaga() {
    this._subscription = this._log.subscribe(record => this.reactTo(record));
    this._aggregates.add(sagaLock);
    this._aggregates.add(sagaFailures);
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
  replay(streamHeads, reader) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  subscribe(subscriber) {
    return {cancel: () => null}
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
    this._buffer = [];
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
    if (this._loading) return new Promise(y => this._onLoad.push(() => y(this)));
    this._loading = true;

    return Promise.resolve()
      .then(() => this._loadSnapshot())
      .then(() => this._subscribeToLog())
      .then(() => this._replayLog())
      .then(() => this._loadingFinished())
      .then(() => this);
  }

  _loadSnapshot() {
    debug('fetch', {key: this._key, version: this._definition.version});
    return this._snapshots.fetch(this._key, this._definition.version)
      .then(snapshot => {
        debug('fetched', {id: this.id, snapshot});
        this._state = snapshot.state;
        this._heads = snapshot.heads;
      })
      .catch(()=>null)
  }

  _replayLog() {
    debug('replay', {key: this._key, heads: this._heads});
    return this._log.replay(this._heads, record => this.apply(record));
  }

  _subscribeToLog() {
    debug('subscribe', {key: this._key});
    this._subscription = this._log.subscribe(record =>
      this._loaded ? this.apply(record) : this._buffer.push(record));
  }

  _loadingFinished() {
    this._loaded = true;
    this._buffer.forEach(record => this.apply(record));
    this._buffer = [];
    this._onLoad.forEach(l => l());
  }

  unload() {
    this._loaded = false;
    this._subscription.cancel();
  }

  takeSnapshot() {
    debug('store', {key: this._key, version: this._definition.version, heads: this._heads});
    this._snapshots.store(this._key, this._definition.version, new Snapshot(this._heads, this._state));
  }

  apply(record) {
    debug('apply', {key: this._key, record, heads: this._heads});
    if (record.sequence <= this._heads[record.streamId]) return;

    (this._definition._appliers[record.event.name] || []).forEach(applier =>
      applier.call(this._state, record.event.payload, record));

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
    if (!this._instances[definition.name] || !this._instances[definition.name][unitId]) {
      debug('load', {name: definition.name, id: unitId});
      this._instances[definition.name] = this._instances[definition.name] || {};
      this._instances[definition.name][unitId] = this._createInstance(definition, unitId);
    }

    return this._instances[definition.name][unitId].load();
  }

  _createInstance(definition, unitId) {
  }

  remove(unit) {
    debug('unload', {name: unit._definition.name, id: unit.id});
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

    debug('record', {id: this.id, sequence: this._heads[this.id], events});
    return this._store.record(events, this.id, this._heads[this.id], command.traceId)
      .catch(e => {
        if (tries > 3) throw e;
        return this._execute(command, tries + 1)
      })
  }
}

class AggregateRepository extends UnitRepository {
  constructor(log, snapshots, store) {
    super(log, snapshots);
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
  constructor(id, definition, log, snapshots) {
    super(id, definition, log, snapshots);
    this._subscriptions = [];
  }

  _loadSnapshot() {
    super._loadSnapshot()
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

  subscribeTo(query, subscriber) {
    var subscription = {query, subscriber, active: true};
    this._subscriptions.push(subscription);
    return this.respondTo(query).then(subscriber).then(() => ({
      cancel: () => subscription.active = false
    }));
  }

  unload() {
    if (this._subscriptions.filter((subscription) => subscription.active).length == 0) {
      super.unload()
    }
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
  constructor(id, definition, log, snapshots, module) {
    super(id, definition, log, snapshots);
    this._module = module;
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
    var reactor = this._definition._reactors[record.event.name];

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
    return this._module.execute(new Command('_lock-saga-reaction', {
      sagaKey: this._key,
      streamId: record.streamId,
      sequence: record.sequence
    }))
      .then(() => true)
      .catch(error => {
        debug('locked', {key: this._key, record, error: error.stack});
        return false;
      })
  }

  _unlockReaction(record) {
    return this._module.execute(new Command('_unlock-saga-reaction', {
      sagaKey: this._key,
      streamId: record.streamId,
      sequence: record.sequence
    }))
  }

  _markReactionFailed(record, errors) {
    return this._module.execute(new Command('_mark-saga-reaction-as-failed', {
      sagaId: this.id,
      sagaKey: this._key,
      record,
      errors
    }))
  }
}

class SagaRepository extends UnitRepository {
  constructor(log, snapshots, module) {
    super(log, snapshots);
    this._module = module;
  }

  _createInstance(definition, sagaId) {
    return new SagaInstance(sagaId, definition, this._log, this._snapshots, this._module);
  }
}

let sagaLock = new Aggregate('_SagaLock')
  .initializing(function () {
    this.locked = {};
  })

  .executing('_lock-saga-reaction', $=>$.sagaKey, function ({sagaKey, streamId, sequence}) {
    if (this.locked[JSON.stringify({streamId, sequence})]) {
      throw new Error('Locked');
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

let sagaFailures = new Aggregate('_SagaFailures')

  .executing('_mark-saga-reaction-as-failed', $=>$.sagaKey, function ({sagaId, sagaKey, record, errors}) {
    return [new Event('_saga-reaction-failed', {sagaId, sagaKey, record, errors})]
  });

//------ SNAPSHOT -----//

class SnapshotStore {
  //noinspection JSUnusedLocalSymbols
  store(key, version, snapshot) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  fetch(key, version) {
    return Promise.reject()
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