const queue = require('queue');
const crypto = require('crypto');

//------ DOMAIN -------//

class Domain {
  constructor(name, eventStore, snapshotStore, repositoryStrategy) {
    this.name = name;
    this._aggregates = new AggregateRepository(name, eventStore, snapshotStore, repositoryStrategy)
  }

  add(unit) {
    this._aggregates.add(unit);
    return this
  }

  execute(command) {
    return this._aggregates
      .getInstance(command)
      .then(instance =>
        instance.execute(command))
      .then(() => this)
  }
}

class Request {
  constructor(name, payload) {
    this.name = name;
    this.payload = payload;
  }
}

class Command extends Request {
  constructor(name, payload, traceId) {
    super(name, payload);
    this.traceId = traceId;
  }
}

class Event extends Request {
  constructor(name, payload, time = new Date()) {
    super(name, payload);
    this.time = time;
  }
}

//----- EVENT BUS ------//

class Message {
  constructor(event, domain, offset) {
    this.event = event;
    this.domain = domain;
    this.offset = offset;
  }
}

class EventBus {
  attach(unit) {
    return Promise.resolve()
  }

  detach(unit) {
    return Promise.resolve()
  }
}

//---- EVENT STORE -----//

class Record {
  constructor(event, revision, traceId) {
    this.event = event;
    this.revision = revision;
    this.traceId = traceId;
  }
}

class EventStore extends EventBus {
  constructor(domain) {
    super();
    this._domain = domain;
  }

  record(events, aggregateId, onRevision, traceId) {
    return Promise.resolve()
  }
}

//------- UNIT ---------//

class Unit {
  constructor(name) {
    this.name = name;
    this._version = null;
    this._initializers = [];
    this._appliers = {};
  }

  canHandle(request) {
  }

  mapToId(request) {
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
      Object.values(this._appliers).map(as => as.map(a =>
        [a.mapper.toString(), a.applier.toString()])),
      Object.values(this._initializers).map(i => i.toString())
    ]);

    return crypto.createHash('md5').update(fingerprint).digest('hex');
  }

  initializing(initializer) {
    this._initializers.push(initializer);
    return this
  }

  applying(domain, eventName, mapper, applier) {
    (this._appliers[eventName] = this._appliers[eventName] || []).push({domain, mapper, applier});
    return this
  }
}

class UnitInstance {
  constructor(id, definition, bus, snapshots) {
    this.id = id;

    this._definition = definition;
    this._bus = bus;
    this._snapshots = snapshots;

    this._head = null;
    this._state = {};

    definition._initializers.forEach(i => i.call(this._state));
  }

  load() {
    return this._loadSnapshot()
      .then(() => this._attachToBus())
      .then(() => this);
  }

  _loadSnapshot() {
    if (process.env.DEBUG) console.log('fetch', {id: this.id, version: this._definition.version});
    return this._snapshots.fetch(this.id, this._definition.version)
      .then(snapshot => {
        if (process.env.DEBUG) console.log('fetched', {id: this.id, snapshot});
        this._state = snapshot.state;
        this._head = snapshot.head;
      })
      .catch(()=>null)
  }

  _attachToBus() {
    if (process.env.DEBUG) console.log('attach', {id: this.id, head: this._head});
    return this._bus.attach(this);
  }

  unload() {
    this._bus.detach(this);
  }

  takeSnapshot() {
    if (process.env.DEBUG) console.log('store', {id: this.id, version: this._definition.version, head: this._head});
    this._snapshots.store(this.id, this._definition.version, new Snapshot(this._head, this._state));
  }

  apply(message) {
    if (message.offset <= this._head) return;

    (this._definition._appliers[message.event.name] || []).forEach(a => {
      if (a.mapper(message.event) != this.id) return;

      if (process.env.DEBUG) console.log('apply', {id: this.id, message});
      a.applier.call(this._state, message.event);
      this._head = message.offset;
    });
  }
}

class UnitRepository {
  constructor(snapshots, strategy) {
    this._snapshots = snapshots;
    this._strategy = strategy.managing(this);
    this._definitions = [];
    this._instances = {};
  }

  add(definition) {
    this._definitions.push(definition);
  }

  getInstance(request) {
    let handlers = this._definitions.filter(d => d.canHandle(request));

    if (handlers.length == 0) {
      throw new Error(`Cannot handle [${request.name}]`)
    } else if (handlers.length > 1) {
      throw new Error(`Too many handlers for [${request.name}]: [${handlers.map(u => u.name).join(', ')}]`)
    }

    var unitDefinition = handlers[0];
    var unitId = unitDefinition.mapToId(request);

    if (!unitId) {
      throw new Error(`Cannot map [${request.name}]`)
    }

    return this._getOrLoad(unitDefinition, unitId)
      .then(instance => {
        this._strategy.notifyAccess(instance);
        return instance
      });
  }

  _getOrLoad(definition, unitId) {
    if (this._instances[unitId]) {
      return Promise.resolve(this._instances[unitId]);
    }

    if (process.env.DEBUG) console.log('load', {id: unitId});
    this._instances[unitId] = this._createInstance(definition, unitId);
    return this._instances[unitId].load();
  }

  remove(unit) {
    if (process.env.DEBUG) console.log('unload', {id: unit.id});
    unit.unload();
    delete this._instances[unit.id];
  }

  _createInstance(definition, unitId) {
  }
}

class RepositoryStrategy {
  managing(unitRepository) {
    this.repository = unitRepository;
    return this
  }

  notifyAccess(unit) {
  }
}

//------ AGGREGATE -----//

class Aggregate extends Unit {
  constructor(name) {
    super(name);
    this._executers = {};
    this._mappers = {};
  }

  canHandle(command) {
    return command.name in this._executers;
  }

  mapToId(command) {
    return this._mappers[command.name](command);
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
  constructor(definition, id, store, snapshots, domain) {
    super(id, definition, store, snapshots);
    this._domain = domain;
    this._store = store;
    this._queue = queue({concurrency: 1, autostart: true})
  }

  execute(command) {
    if (process.env.DEBUG) console.log('execute', {command, id: this.id});
    return new Promise((y, n) =>
      this._queue.push(() => this._execute(command).then(y).catch(n)));
  }

  _execute(command, tries = 0) {
    let events = this._definition._executers[command.name].call(this._state, command);

    if (!Array.isArray(events)) {
      return Promise.resolve();
    }

    if (process.env.DEBUG) console.log('record', {id: this.id, revision: this._head, events});
    return this._store.record(events, this.id, this._head, command.traceId)
      .catch(e => {
        if (tries > 3) throw e;
        return this._execute(command, tries + 1)
      })
  }
}

class AggregateRepository extends UnitRepository {
  constructor(domain, store, snapshots, strategy) {
    super(snapshots, strategy);
    this._domain = domain;
    this._store = store;
  }

  _createInstance(definition, aggregateId) {
    return new AggregateInstance(definition, aggregateId, this._store, this._snapshots, this._domain);
  }
}

//------ SNAPSHOT -----//

class SnapshotStore {
  store(id, version, snapshot) {
    return Promise.resolve()
  }

  fetch(id, version) {
    return Promise.reject()
  }
}

class Snapshot {
  constructor(head, state) {
    this.head = head;
    this.state = state;
  }
}

module.exports = {
  Domain,
  Command,
  Event,

  Record,
  EventStore,

  Message,
  EventBus,

  Unit,
  UnitInstance,
  RepositoryStrategy,

  Aggregate,
  AggregateInstance,
  AggregateRepository,

  SnapshotStore,
  Snapshot
};