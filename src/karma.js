const queue = require('queue');

class Domain {
  constructor(eventBus, snapshotStore, repositoryStrategy) {
    this._bus = eventBus;
    this._aggregates = new AggregateRepository(eventBus, snapshotStore, repositoryStrategy)
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

class Unit {
  constructor(name) {
    this.name = name;
    this.version = null;
    this._initializers = [];
    this._appliers = {};
  }

  withVersion(version) {
    this.version = version;
    return this
  }

  init(initializer) {
    this._initializers.push(initializer);
    return this
  }

  applying(eventName, mapper, applier) {
    (this._appliers[eventName] = this._appliers[eventName] || []).push({mapper, applier});
    return this
  }
}

class UnitInstance {
  constructor(definition, id, bus, snapshots) {
    this.definition = definition;
    this.id = id;
    this._bus = bus;
    this._snapshots = snapshots;
    this.sequence = 0;
    this.state = {};

    definition._initializers.forEach(i => i.call(this.state));
  }

  load() {
    return this._loadSnapshot()
      .then(() => this._subscribeToBus())
      .then(() => this);
  }

  _loadSnapshot() {
    return this._snapshots.fetch(this.id, this.definition.version)
      .then(snapshot => {
        if (snapshot) {
          this.state = snapshot.state;
          this.sequence = snapshot.sequence;
        }
      })
  }

  _subscribeToBus() {
    let filter = this._bus.filter()
      .nameIsIn(Object.keys(this.definition._appliers || {}))
      .after(this.sequence);

    if (process.env.DEBUG) console.log('subscribe', {filter, id: this.id});
    return this._bus.subscribe(this.id, this.apply.bind(this), filter);
  }

  takeSnapshot() {
    this._snapshots.store(this.id, this.definition.version, new Snapshot(this.sequence, this.state));
  }

  apply(event) {
    if (this.definition._appliers[event.name]) {
      this.definition._appliers[event.name].forEach(a => {
        if (a.mapper(event) == this.id) {
          if (process.env.DEBUG) console.log('apply', {event, id: this.id});
          a.applier.call(this.state, event);
          this.sequence = event.sequence;
        }
      });
    }
  }
}

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
  constructor(definition, id, bus, snapshots) {
    super(definition, id, bus, snapshots);
    this._queue = queue({concurrency: 1, autostart: true})
  }

  execute(command) {
    if (process.env.DEBUG) console.log('execute', {command, id: this.id});
    return new Promise((y, n) =>
      this._queue.push(() => this._execute(command).then(y).catch(n)));
  }

  _execute(command, tries = 0) {
    let events = this.definition._executers[command.name].call(this.state, command);
    if (!Array.isArray(events)) {
      return Promise.resolve();
    }

    let fullEvents = events.map(e => new Event(e.name, e.payload, new Date(), command.traceId));

    if (process.env.DEBUG) console.log('publish', {id: this.id, seq: this.sequence});
    return this._bus.publish(fullEvents, this.id, this.sequence)
      .catch(e => {
        if (tries > 3) throw e;
        return this._execute(command, tries + 1)
      })
  }
}

class AggregateRepository {
  constructor(bus, snapshots, strategy) {
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

    this._instances[aggregateId] = new AggregateInstance(definition, aggregateId, this._bus, this._snapshots);
    return this._instances[aggregateId].load();
  }

  unload(unit) {
    delete this._instances[unit.id];
    this._bus.unsubscribe(unit.id);
  }
}

class RepositoryStrategy {
  managing(repository) {
    this.repository = repository;
    return this
  }

  notifyAccess(unit) {
  }
}

class EventBus {
  publish(sequenceId, headSequence, events) {
    return Promise.resolve(this)
  }

  subscribe(id, subscriber, filter) {
    return Promise.resolve(this)
  }

  unsubscribe(id) {
  }

  filter() {
    return new EventFilter()
  }
}

class EventFilter {
  nameIsIn(strings) {
    return this
  }

  after(sequence) {
    return this
  }
}

class Event {
  constructor(name, payload, timestamp, traceId, sequence = null) {
    this.name = name;
    this.payload = payload;
    this.timestamp = timestamp;
    this.traceId = traceId;
    this.sequence = sequence;
  }

  withSequence(sequence) {
    this.sequence = sequence;
    return this
  }
}

class SnapshotStore {
  store(id, version, snapshot) {
    return Promise.resolve()
  }

  fetch(id, version) {
    return Promise.resolve()
  }
}

class Snapshot {
  constructor(sequence, state) {
    this.sequence = sequence;
    this.state = state;
  }
}

module.exports = {
  Domain,
  Command,
  Unit,
  UnitInstance,
  Aggregate,
  AggregateInstance,
  AggregateRepository,
  RepositoryStrategy,
  EventBus,
  EventFilter,
  Event,
  SnapshotStore,
  Snapshot
};