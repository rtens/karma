const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const {
  Domain,
  Command,
  Aggregate,
  RepositoryStrategy,
  EventBus,
  Event,
  SnapshotStore,
  Snapshot
} = require('../../src/index');

const {
  FakeEventBus,
  FakeRepositoryStrategy,
  FakeSnapshotStore
} = require('./fakes');


describe('Command execution', () => {

  let _Date = Date;

  before(() => {
    Date = function () {
      return new _Date('2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;
  });

  after(() => {
    Date = _Date;
  });

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
        .executing('Foo', ()=>'id', command => [
          new Event('food', command.payload),
          new Event('bard', 'two')
        ]))

      .execute(new Command('Foo', 'one', 'trace'))

      .then(() => bus.published.should.eql([{
        events: [
          {name: 'food', payload: 'one', timestamp: new Date(), traceId: 'trace', sequence: null},
          {name: 'bard', payload: 'two', timestamp: new Date(), traceId: 'trace', sequence: null},
        ],
        sequenceId: 'id',
        headSequence: 0
      }]));
  });

  it('fails if Events cannot be published', () => {
    let bus = new FakeEventBus();
    bus.publish = () => {
      throw new Error('Nope')
    };

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries publishing before giving up', () => {
    let bus = new FakeEventBus();
    let count = 0;
    bus.publish = () => new Promise(y => {
      if (count++ < 3) throw new Error(count);
      y()
    });

    return new Domain(bus, new SnapshotStore(), new RepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('reconstitutes an Aggregate from Events', () => {
    let bus = new FakeEventBus();
    bus.publish([
      new Event('bard', {id: 'foo', baz: 'one'}).withSequence(21),
      new Event('bard', {id: 'not'}).withSequence(22),
      new Event('bard', {id: 'foo', baz: 'two'}).withSequence(23),
      new Event('not').withSequence(24)
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
        sequence: 0
      }]))

      .then(() => bus.published[1].should.eql({
        events: [new Event('food', ['one', 'two'], new Date())],
        sequenceId: 'foo',
        headSequence: 23
      }))
  });

  it('reconstitutes an Aggregate from a Snapshot and Events', () => {
    let bus = new FakeEventBus();
    bus.publish([new Event('bard', 'one').withSequence(42)]);

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

      .then(() => bus.subscribed.should.eql([{names: ['bard'], sequence: 21}]))

      .then(() => bus.published.slice(1).should.eql([{
        events: [new Event('food', ['snap', 'one'], new Date())],
        sequenceId: 'foo',
        headSequence: 42
      }]))
  });

  it('keeps the reconstituted Aggregate', () => {
    let bus = new FakeEventBus();
    bus.publish([new Event('bard', 'a ').withSequence(21)]);

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
        sequenceId: 'foo',
        headSequence: 21
      }, {
        events: [new Event('food', 'a two', new Date())],
        sequenceId: 'foo',
        headSequence: 21
      }]))
  });

  it('can take a Snapshot', () => {
    let bus = new FakeEventBus();
    bus.publish([
      new Event('bard', 'one').withSequence(21)
    ]);

    let snapshots = new FakeSnapshotStore();

    let strategy = new FakeRepositoryStrategy()
      .onAccess(unit => unit.takeSnapshot());

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

      .then(() => snapshots.stored.should.eql([
        {id: 'foo', version: 'v1', snapshot: {sequence: 21, state: {bards: ['one']}}},
        {id: 'foo', version: 'v1', snapshot: {sequence: 21, state: {bards: ['one']}}},
      ]))
  });

  it('can unload an Aggregate', () => {
    let bus = new FakeEventBus();
    bus.publish([
      new Event('bard', 'one').withSequence(21)
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

      .then(() => snapshots.fetched.length.should.equal(2))

      .then(() => bus.subscribed.length.should.equal(2))
  });

  it('queues Commands per Aggregate', () => {
    var bus = new (class extends FakeEventBus {
      //noinspection JSUnusedGlobalSymbols
      publish(events, onSequence) {
        return new Promise(y => {
          setTimeout(() => y(super.publish(events, onSequence)),
            events[0].name == 'Foo' ? 30 : 0);
        })
      }
    });

    var domain = new Domain(bus, new FakeSnapshotStore(), new FakeRepositoryStrategy())

      .add(new Aggregate()
        .executing('Foo', ()=>'one', () => [new Event('Foo')])
        .executing('Bar', ()=>'one', () => [new Event('Bar')])
        .executing('Baz', ()=>'two', () => [new Event('Baz')]));

    return new Promise(y => {
      setTimeout(() => domain.execute(new Command('Foo')), 0);
      setTimeout(() => domain.execute(new Command('Bar')).then(y), 10);
      setTimeout(() => domain.execute(new Command('Baz')), 15);
    }).then(() =>
      bus.published.map(p=>p.events[0].name).should.eql(['Baz', 'Foo', 'Bar']))
  });
});