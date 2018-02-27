const queue = require('queue');
const crypto = require('crypto');
const Promise = require("bluebird");

//------ DOMAIN -------//

class Domain {
  constructor(name, eventStore, eventBus, snapshotStore, repositoryStrategy) {
    this.name = name;
    this._aggregates = new AggregateRepository(name, eventStore, eventBus, snapshotStore, repositoryStrategy)
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

class Command {
  constructor(name, payload, traceId) {
    this.name = name;
    this.payload = payload;
    this.traceId = traceId;
  }
}

class Event {
  constructor(name, payload, time = new Date()) {
    this.name = name;
    this.payload = payload;
    this.time = time;
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

class EventStore {
  record(events, aggregateId, onRevision, traceId) {
    return Promise.resolve()
  }

  read(aggregateId, recordReader, filter) {
    return Promise.resolve()
  }

  detach(aggregateId) {
  }

  filter() {
    return new RecordFilter()
  }
}

class RecordFilter {
  nameIsIn(strings) {
    return this
  }

  after(revision) {
    return this
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
  publish(event, domain) {
    return Promise.resolve()
  }

  subscribe(subscriberId, messageSubscriber, messageFilter) {
    return Promise.resolve()
  }

  unsubscribe(subscriberId) {
    return Promise.resolve()
  }

  filter() {
    return new MessageFilter();
  }
}

class MessageFilter {
  after(offset) {
    return this
  }

  from(domain) {
    return this
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
      .then(() => this._subscribeToBus())
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

  _subscribeToBus() {
    return Promise.resolve();
  }

  unload() {
    this._bus.unsubscribe(this.id);
  }

  takeSnapshot() {
    if (process.env.DEBUG) console.log('store', {id: this.id, version: this._definition.version});
    this._snapshots.store(this.id, this._definition.version, new Snapshot(this._head, this._state));
  }

  apply(message) {
    (this._definition._appliers[message.event.name] || []).forEach(a => {
      if (a.mapper(message.event) != this.id) return;

      if (process.env.DEBUG) console.log('apply', {id: this.id, message});
      a.applier.call(this._state, message.event);
      this._head = message.offset;
    });
  }
}

class UnitRepository {
  add(unitClass) {
  }

  remove(unit) {
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

  mapToId(command) {
    var aggregateId = this._mappers[command.name](command);
    if (!aggregateId) {
      throw new Error(`Cannot map [${command.name}]`)
    }

    return aggregateId;
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
  constructor(domain, id, definition, store, bus, snapshots) {
    super(id, definition, bus, snapshots);
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
      .then(() => Promise.each(events, e => this._bus.publish(e, this._domain)))
  }

  _subscribeToBus() {
    let filter = this._store.filter()
      .nameIsIn(Object.keys(this._definition._appliers || {}))
      .after(this._head);

    if (process.env.DEBUG) console.log('read', {id: this.id, filter});
    return this._store.read(this.id, this.apply.bind(this), filter);
  }

  apply(record) {
    super.apply(new Message(record.event, this._domain, record.revision));
  }

  unload() {
    this._store.detach(this.id);
  }
}

class AggregateRepository extends UnitRepository {
  constructor(domain, store, bus, snapshots, strategy) {
    super();
    this._domain = domain;
    this._store = store;
    this._bus = bus;
    this._snapshots = snapshots;
    this._strategy = strategy.managing(this);
    this._definitions = {};
    this._instances = {};
  }

  add(aggregateClass) {
    Object.keys(aggregateClass._executers).forEach(cn => {
      if (cn in this._definitions) {
        throw new Error(`[${this._definitions[cn].name}] is already executing [${cn}]`)
      }

      this._definitions[cn] = aggregateClass;
    });
  }

  getInstance(command) {
    let definition = this._definitions[command.name];
    if (!definition) {
      throw new Error(`Cannot execute [${command.name}]`)
    }

    return this._getOrLoad(definition, command)
      .then(instance => {
        this._strategy.notifyAccess(instance);
        return instance
      });
  }

  _getOrLoad(definition, command) {
    let aggregateId = definition.mapToId(command);
    if (this._instances[aggregateId]) {
      return Promise.resolve(this._instances[aggregateId]);
    }

    this._instances[aggregateId] =
      new AggregateInstance(this._domain, aggregateId, definition, this._store, this._bus, this._snapshots);
    return this._instances[aggregateId].load();
  }

  remove(unit) {
    if (process.env.DEBUG) console.log('unload', {id: unit.id});
    unit.unload();
    delete this._instances[unit.id];
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
  RecordFilter,

  Message,
  EventBus,
  MessageFilter,

  Unit,
  UnitInstance,
  RepositoryStrategy,

  Aggregate,
  AggregateInstance,
  AggregateRepository,

  SnapshotStore,
  Snapshot
};