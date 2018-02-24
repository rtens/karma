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
      new Domain()

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot execute [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => {
      //noinspection JSUnusedLocalSymbols
      new Domain()

        .add(class One extends Aggregate {
        }
          .executing('Foo')
          .executing('Foo'))

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    (() => {
      //noinspection JSUnusedLocalSymbols
      new Domain()

        .add(class One extends Aggregate {
        }
          .executing('Foo'))

        .add(class extends Aggregate {
        }
          .executing('Foo'))

        .execute(new Command('Foo'));

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => {
      new Domain(new EventBus())

        .add(class extends Aggregate {
        }
          .executing('Foo', ()=>null))

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return new Domain(new EventBus(), new SnapshotStore())

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, command => {
          executed.push(command);
        }))

      .execute(new Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql([{name: 'Foo', payload: 'one', traceId: 'trace'}]))
  });

  it('fails if the Command is rejected', () => {
    return new Domain(new EventBus(), new SnapshotStore())

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function () {
          throw new Error('Nope')
        }))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('publishes Events', () => {
    let bus = new FakeEventBus();

    return new Domain(bus, new SnapshotStore())

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function (command) {
          this.record('food', command.payload);
          this.record('bard', 'two');
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

    return new Domain(bus, new SnapshotStore())

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function () {
        }))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries publishing before giving up', () => {
    let bus = new FakeEventBus();
    let count = 0;
    bus.publish = () => {
      if (count++ < 3) throw new Error()
    };

    return new Domain(bus, new SnapshotStore())

      .add(class extends Aggregate {
      }
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

    return new Domain(bus, new SnapshotStore())

      .add(class extends Aggregate {
        constructor(id) {
          super(id);
          this.bards = [];
        }
      }
        .applying('nothing')
        .applying('bard', event=>event.payload.id, function (event) {
          this.bards.push(event.payload.baz);
        })
        .executing('Foo', command=>command.payload, function () {
          this.record('food', this.bards)
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
    bus.publish([
      new Event('bard', 'one').withOffset(42),
    ]);

    let snapshots = new FakeSnapshotStore();
    snapshots.store('foo', 1, new Snapshot(21, {bards: ['snap']}));

    return new Domain(bus, snapshots)

      .add(class extends Aggregate {
      }
        .applying('bard', ()=>'foo', function (event) {
          this.bards.push(event.payload)
        })
        .executing('Foo', ()=>'foo', function () {
          this.record('food', this.bards)
        }))

      .execute(new Command('Foo'))

      .then(() => bus.subscribed.should.eql([{
        names: ['bard'],
        offset: 21
      }]))

      .then(() => bus.published[1].should.eql({
        events: [new Event('food', ['snap', 'one'], new Date())],
        followOffset: 42
      }))
  });

  it('keeps the reconstituted Aggregate');

  it('can take a Snapshot and unload an Aggregate');

  it('can use singleton Aggregates');
});

class Domain {
  constructor(eventBus, snapshotStore) {
    this._bus = eventBus;
    this._snapshots = snapshotStore;
    this._aggregates = new AggregateRepository()
  }

  add(unit) {
    this._aggregates.add(unit);
    return this
  }

  execute(command) {
    return this._executeAndPublish(command,
      this._aggregates
        .mapToInstance(command)
        .loadFrom(this._snapshots)
        .subscribeTo(this._bus));
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
  constructor(id, version = 1) {
    this.id = id;
    this.version = version;
    this.offset = 0;
  }

  loadFrom(snapshots) {
    let snapshot = snapshots.fetch(this.id, this.version);
    if (snapshot) {
      Object.keys(snapshot.state).forEach(k => this[k] = snapshot.state[k]);
      this.offset = snapshot.offset;
    }
    return this
  }

  subscribeTo(bus) {
    bus.subscribe(this.apply.bind(this), bus.filter()
      .nameIsIn(Object.keys(this.constructor._appliers || {}))
      .afterOffset(this.offset));
    return this
  }

  apply(event) {
    if (this.constructor._appliers[event.name]) {
      this.constructor._appliers[event.name].forEach(a => {
        if (a.mapper(event) == this.id) {
          a.applier.call(this, event)
        }
      });
      this.offset = event.offset
    }
  }

  static applying(eventName, mapper, applier) {
    this._appliers = this._appliers || {};
    (this._appliers[eventName] = this._appliers[eventName] || []).push({mapper, applier});
    return this
  }
}

class Aggregate extends Unit {
  execute(command) {
    return new Promise(y => {
      let events = [];
      this.record = (eventName, payload) =>
        events.push(new Event(eventName, payload, new Date(), command.traceId));

      this.constructor._executers[command.name].call(this, command);

      y(events)
    })
  }

  static mapToId(command) {
    var aggregateId = this._mappers[command.name](command);
    if (!aggregateId) {
      throw new Error(`Cannot map [${command.name}]`)
    }

    return aggregateId;
  }

  static executing(commandName, mapper, executer) {
    this._executers = this._executers || {};
    this._mappers = this._mappers || {};

    if (commandName in this._executers) {
      throw new Error(`[${this.name}] is already executing [${commandName}]`)
    }

    this._executers[commandName] = executer;
    this._mappers[commandName] = mapper;
    return this
  }
}

class AggregateRepository {
  constructor() {
    this._classes = {};
  }

  add(aggregateClass) {
    Object.keys(aggregateClass._executers).forEach(cn => {
      if (cn in this._classes) {
        throw new Error(`[${this._classes[cn].name}] is already executing [${cn}]`)
      }

      this._classes[cn] = aggregateClass;
    });
  }

  mapToInstance(command) {
    var clasz = this._classes[command.name];

    if (!clasz) {
      throw new Error(`Cannot execute [${command.name}]`)
    }

    return new clasz(clasz.mapToId(command));
  }
}

class EventBus {
  publish(event, followOffset) {
  }

  subscribe(subscriber, filter) {
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
    this.published.push({events, followOffset})
  }

  subscribe(subscriber, filter) {
    this.subscribed.push(filter);
    this.published.forEach(({events}) => events.forEach(subscriber))
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
  }

  store(id, version, snapshot) {
    this.snapshots[id + version] = snapshot;
  }

  fetch(id, version) {
    return this.snapshots[id + version];
  }
}