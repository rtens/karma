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
      .then(aggregate =>
        this._executeAndPublish(command, aggregate))
      .then(() => this)
  }

  _executeAndPublish(command, aggregate, tries = 0) {
    return aggregate
      .execute(command)
      .then(events =>
        this._bus.publish(events, aggregate.offset))
      .catch(e => {
        if (tries > 3) throw e;
        return this._executeAndPublish(command, aggregate, tries + 1)
      });
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
  constructor(definition, id) {
    this.definition = definition;
    this.id = id;
    this.offset = 0;
    this.state = {};

    definition._initializers.forEach(i => i.call(this.state));
  }

  loadFrom(snapshots) {
    return snapshots.fetch(this.id, this.definition.version)
      .then(snapshot => {
        if (snapshot) {
          this.state = snapshot.state;
          this.offset = snapshot.offset;
        }
        return this
      })
  }

  storeTo(snapshots) {
    snapshots.store(this.id, this.definition.version, new Snapshot(this.offset, this.state));
  }

  subscribeTo(bus) {
    let filter = bus.filter()
      .nameIsIn(Object.keys(this.definition._appliers || {}))
      .afterOffset(this.offset);

    return bus.subscribe(this.apply.bind(this), filter)
      .then(() => this);
  }

  apply(event) {
    if (this.definition._appliers[event.name]) {
      this.definition._appliers[event.name].forEach(a => {
        if (a.mapper(event) == this.id) {
          a.applier.call(this.state, event)
        }
      });
      this.offset = event.offset
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
  execute(command) {
    return new Promise(y => {
      y((this.definition._executers[command.name].call(this.state, command) || [])
        .map(e => new Event(e.name, e.payload, new Date(), command.traceId)));
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
    var definition = this._definitions[command.name];
    if (!definition) {
      throw new Error(`Cannot execute [${command.name}]`)
    }

    var aggregateId = definition.mapToId(command);
    return Promise.resolve(this._instances[aggregateId] || this._loadInstance(definition, aggregateId))
      .then(instance => {
        this._strategy.notifyAccess(instance);
        return instance
      });
  }

  _loadInstance(definition, aggregateId) {
    let instance = new AggregateInstance(definition, aggregateId);
    this._instances[aggregateId] = instance;

    return instance.loadFrom(this._snapshots)
      .then(() => instance.subscribeTo(this._bus))
      .then(() => instance);
  }

  unload(unit) {
    unit.storeTo(this._snapshots);
    delete this._instances[unit.id];
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
  publish(event, followOffset) {
    return Promise.resolve()
  }

  subscribe(subscriber, filter) {
    return Promise.resolve()
  }

  filter() {
    return new EventFilter()
  }
}

class EventFilter {
  nameIsIn(strings) {
    return this
  }

  afterOffset(offset) {
    return this
  }
}

class Event {
  constructor(name, payload, timestamp, traceId, offset = null) {
    this.name = name;
    this.payload = payload;
    this.timestamp = timestamp;
    this.traceId = traceId;
    this.offset = offset;
  }

  withOffset(v) {
    this.offset = v;
    return this
  }
}

class SnapshotStore {
  store(id, version, snapshot) {
  }

  fetch(id, version) {
    return Promise.resolve()
  }
}

class Snapshot {
  constructor(offset, state) {
    this.offset = offset;
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