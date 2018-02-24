let chai = require('chai');
let promised = require('chai-as-promised');

chai.use(promised);
chai.should();

let _Date = Date;
Date = function () {
  return new _Date('2011-12-13T14:15:16Z');
};
Date.prototype = _Date.prototype;

describe('Command execution', () => {

  it('fails if no executer is defined', () => {
    (() => {
      new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot execute [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => {
      new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

        .add(new Aggregate('One')
          .executing('Foo')
          .executing('Foo'))

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    (() => {
      new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

        .add(new Aggregate('One')
          .executing('Foo'))

        .add(new Aggregate()
          .executing('Foo'))

        .execute(new Command('Foo'));

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => {
      new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

        .add(new Aggregate()
          .executing('Foo', ()=>null))

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, command => {
          executed.push(command);
        }))

      .execute(new Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql([{name: 'Foo', payload: 'one', traceId: 'trace'}]))
  });

  it('fails if the Command is rejected', () => {
    return new Domain(new EventBus(), new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, function () {
          throw new Error('Nope')
        }))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('publishes Events', () => {
    let bus = new FakeEventBus();

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, function (command) {
          return [
            new Event('food', command.payload),
            new Event('bard', 'two')
          ]
        }))

      .execute(new Command('Foo', 'one', 'trace'))

      .then(() => bus.published.should.eql([{
        events: [
          {name: 'food', payload: 'one', timestamp: new Date(), traceId: 'trace', offset: null},
          {name: 'bard', payload: 'two', timestamp: new Date(), traceId: 'trace', offset: null},
        ],
        followOffset: 0
      }]))
  });

  it('fails if Events cannot be published', () => {
    let bus = new FakeEventBus();
    bus.publish = () => {
      throw new Error('Nope')
    };

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, () => null))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries publishing before giving up', () => {
    let bus = new FakeEventBus();
    let count = 0;
    bus.publish = () => {
      if (count++ < 3) throw new Error()
    };

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, function () {
        }))

      .execute(new Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('reconstitutes an Aggregate from Events', () => {
    let bus = new FakeEventBus();
    bus.publish([
      new Event('bard', {id: 'foo', baz: 'one'}).withOffset(21),
      new Event('bard', {id: 'not'}).withOffset(22),
      new Event('bard', {id: 'foo', baz: 'two'}).withOffset(23),
      new Event('not').withOffset(24)
    ]);

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .init(function () {
          this.bards = [];
        })
        .applying('nothing')
        .applying('bard', event=>event.payload.id, function (event) {
          this.bards.push(event.payload.baz);
        })
        .executing('Foo', command=>command.payload, function () {
          return [new Event('food', this.bards)]
        }))

      .execute(new Command('Foo', 'foo'))

      .then(() => bus.subscribed.should.eql([{
        names: ['nothing', 'bard'],
        offset: 0
      }]))

      .then(() => bus.published[1].should.eql({
        events: [new Event('food', ['one', 'two'], new Date())],
        followOffset: 23
      }))
  });

  it('reconstitutes an Aggregate from a Snapshot and Events', () => {
    let bus = new FakeEventBus();
    bus.publish([new Event('bard', 'one').withOffset(42)]);

    let snapshots = new FakeSnapshotStore();
    snapshots.store('foo', 'v1', new Snapshot(21, {bards: ['snap']}));

    return new Domain(bus, snapshots, new RepositoryStrategy())

      .add(new Aggregate()
        .withVersion('v1')
        .applying('bard', ()=>'foo', function (event) {
          this.bards.push(event.payload)
        })
        .executing('Foo', ()=>'foo', function () {
          return [new Event('food', this.bards)]
        }))

      .execute(new Command('Foo'))

      .then(() => snapshots.fetched.should.eql([{id: 'foo', version: 'v1'}]))

      .then(() => bus.subscribed.should.eql([{names: ['bard'], offset: 21}]))

      .then(() => bus.published.slice(1).should.eql([{
        events: [new Event('food', ['snap', 'one'], new Date())],
        followOffset: 42
      }]))
  });

  it('keeps the reconstituted Aggregate', () => {
    let bus = new FakeEventBus();
    bus.publish([new Event('bard', 'a ').withOffset(21)]);

    let snapshots = new FakeSnapshotStore();

    return new Domain(bus, snapshots, new RepositoryStrategy())

      .add(new Aggregate()
        .init(function () {
          this.bards = [];
        })
        .applying('bard', ()=>'foo', function (event) {
          this.bards.push(event.payload);
        })
        .executing('Foo', ()=>'foo', function (command) {
          return [new Event('food', this.bards + command.payload)]
        }))

      .execute(new Command('Foo', 'one'))

      .then(domain => domain.execute(new Command('Foo', 'two')))

      .then(() => snapshots.fetched.length.should.equal(1))

      .then(() => bus.subscribed.length.should.equal(1))

      .then(() => bus.published.slice(1).should.eql([{
        events: [new Event('food', 'a one', new Date())],
        followOffset: 21
      }, {
        events: [new Event('food', 'a two', new Date())],
        followOffset: 21
      }]))
  });

  it('can take a Snapshot and unload an Aggregate', () => {
    let bus = new FakeEventBus();
    bus.publish([
      new Event('bard', 'one').withOffset(21)
    ]);

    let snapshots = new FakeSnapshotStore();

    let strategy = new FakeRepositoryStrategy()
      .onAccess(function (unit) {
        this.repository.unload(unit);
      });

    return new Domain(bus, snapshots, strategy)

      .add(new Aggregate()
        .init(function () {
          this.bards = [];
        })
        .withVersion('v1')
        .applying('bard', ()=>'foo', function (event) {
          this.bards.push(event.payload);
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new Command('Foo', 'foo'))

      .then(domain => domain.execute(new Command('Foo')))

      .then(() => snapshots.fetched.should.eql([
        {id: 'foo', version: 'v1'},
        {id: 'foo', version: 'v1'}
      ]))

      .then(() => bus.subscribed.should.eql([
        {names: ['bard'], offset: 0},
        {names: ['bard'], offset: 21}
      ]))

      .then(() => snapshots.stored.should.eql([
        {id: 'foo', version: 'v1', snapshot: {offset: 21, state: {bards: ['one', 'one']}}},
        {id: 'foo', version: 'v1', snapshot: {offset: 21, state: {bards: ['one', 'one']}}},
      ]))
  });
});

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

class FakeRepositoryStrategy extends RepositoryStrategy {
  onAccess(callback) {
    this._onAccess = callback;
    return this
  }

  notifyAccess(unit) {
    this._onAccess(unit)
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

class FakeEventBus extends EventBus {
  constructor() {
    super();
    this.published = [];
    this.subscribed = [];
  }

  publish(events, followOffset) {
    this.published.push({events, followOffset});
    return Promise.resolve();
  }

  subscribe(subscriber, filter) {
    this.subscribed.push(filter);
    this.published.forEach(({events}) => events.forEach(subscriber));
    return Promise.resolve();
  }

  filter() {
    return new FakeEventFilter()
  }
}

class FakeEventFilter {
  nameIsIn(strings) {
    this.names = strings;
    return this
  }

  afterOffset(offset) {
    this.offset = offset;
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

class FakeSnapshotStore {
  constructor() {
    this.snapshots = {};
    this.fetched = [];
    this.stored = [];
  }

  store(id, version, snapshot) {
    this.stored.push({id, version, snapshot});
    this.snapshots[id + version] = snapshot;
  }

  fetch(id, version) {
    this.fetched.push({id, version});
    return Promise.resolve(this.snapshots[id + version])
  }
}