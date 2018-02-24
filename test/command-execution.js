let chai = require('chai');
let promised = require('chai-as-promised');

let {
  Domain,
  Command,
  Aggregate,
  RepositoryStrategy,
  EventBus,
  Event,
  SnapshotStore,
  Snapshot
} = require('../index');

let {
  FakeEventBus,
  FakeRepositoryStrategy,
  FakeSnapshotStore
} = require('./fakes');

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