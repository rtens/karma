const crypto = require('crypto');

//------ DOMAIN -------//

class Module {
  constructor(eventLog, snapshotStore, repositoryStrategy, eventStore) {
    this._strategy = repositoryStrategy;
    this._aggregates = new AggregateRepository(eventLog, snapshotStore, repositoryStrategy, eventStore);
    this._projections = new ProjectionRepository(eventLog, snapshotStore, repositoryStrategy);
  }

  add(unit) {
    switch (unit.constructor.name) {
      case Aggregate.name:
        this._aggregates.add(unit);
        break;
      case Projection.name:
        this._projections.add(unit);
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
  subscribe(subscriptionId, streamHeads, subscriber) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  cancel(subscriptionId) {
    return Promise.resolve()
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

  _subscribeToLog() {
    debug('subscribe', {key: this._key, heads: this._heads});
    return this._log.subscribe(this._key, this._heads, record => this.apply(record));
  }

  _loadingFinished() {
    this._loaded = true;
    this._onLoad.forEach(l => l());
  }

  unload() {
    this._loaded = false;
    this._log.cancel(this._key);
  }

  takeSnapshot() {
    debug('store', {key: this._key, version: this._definition.version, heads: this._heads});
    this._snapshots.store(this._key, this._definition.version, new Snapshot(this._heads, this._state));
  }

  apply(record) {
    if (record.sequence <= this._heads[record.streamId]) return;

    debug('apply', {key: this._key, record});
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

  getInstance(message) {
    let handlers = this._definitions.filter(d => d.canHandle(message));

    if (handlers.length == 0) {
      throw new Error(`Cannot handle [${message.name}]`)
    } else if (handlers.length > 1) {
      throw new Error(`Too many handlers for [${message.name}]: [${handlers.map(u => u.name).join(', ')}]`)
    }

    var unitDefinition = handlers[0];
    var unitId = unitDefinition.mapToId(message);

    if (!unitId) {
      throw new Error(`Cannot map [${message.name}]`)
    }

    return this._getOrLoad(unitDefinition, unitId);
  }

  _getOrLoad(definition, unitId) {
    if (this._instances[unitId]) {
      return this._instances[unitId].load();
    }

    debug('load', {id: unitId});
    this._instances[unitId] = this._createInstance(definition, unitId);
    return this._instances[unitId].load();
  }

  _createInstance(definition, unitId) {
  }

  remove(unit) {
    debug('unload', {id: unit.id});
    delete this._instances[unit.id];
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

  applying(eventName, mapper, applier) {
    return super.applying(eventName, mapper, applier);
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
  constructor(log, snapshots, strategy, store) {
    super(log, snapshots, strategy);
    this._store = store;
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
    this._state = new Proxy(this._state, {
      ['set']: (target, name, value) => {
        target[name] = value;
        this._subscriptions
          .filter((subscription) => subscription.active)
          .forEach(({query, subscriber}) => this.respondTo(query).then(subscriber));
      }
    })
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
  _createInstance(definition, projectionId) {
    return new ProjectionInstance(projectionId, definition, this._log, this._snapshots);
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
  Command,
  Query,
  Event,

  Record,
  EventStore,

  Message,
  EventLog,

  Unit,
  UnitInstance,
  RepositoryStrategy,

  Aggregate,
  AggregateInstance,
  AggregateRepository,

  Projection,

  SnapshotStore,
  Snapshot
};

function debug(tag, message) {
  if (process.env.DEBUG) console.log(tag, JSON.stringify(message));
}