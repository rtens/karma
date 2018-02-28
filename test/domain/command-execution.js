const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

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

  let Domain = (name, deps = {}) =>
    new k.Domain(name,
      deps.store || new k.EventStore(),
      deps.snapshots || new k.SnapshotStore,
      deps.strategy || new k.RepositoryStrategy);

  it('fails if no executer is defined', () => {
    (() => Domain()

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot handle [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate('One')
        .executing('Foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo'))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Too many handlers for [Foo]: [One, Two]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, command => {
          executed.push(command);
        }))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql([{name: 'Foo', payload: 'one', traceId: 'trace'}]))
  });

  it('fails if the Command is rejected', () => {
    return Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', command => [
          new k.Event('food', command.payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        aggregateId: 'id',
        onRevision: null,
        traceId: 'trace'
      }]));
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', () => []))

      .execute(new k.Command('Foo', null, 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [],
        aggregateId: 'id',
        onRevision: null,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let store = new fake.EventStore();
    store.record = () => {
      return Promise.reject(new Error('Nope'))
    };

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries recording before giving up', () => {
    let store = new fake.EventStore();
    let count = 0;
    store.record = () => new Promise(y => {
      if (count++ < 3) throw new Error(count);
      y()
    });

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new k.Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('reconstitutes an Aggregate from Events', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', {id: 'foo', baz: 'one'}), 21),
      new k.Record(new k.Event('bard', {id: 'foo', baz: 'two'}), 22),
      new k.Record(new k.Event('nope', {id: 'foo', baz: 'not'}), 23)
    ];

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .initializing(function () {
          this.bards = [];
        })
        .applying('Test', 'nothing', ()=>null, ()=>null)
        .applying('Test', 'bard', event=>event.payload.id, function (event) {
          this.bards.push(event.payload.baz);
        })
        .executing('Foo', command=>command.payload, function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.attached.should.eql([{
        aggregateId: 'foo',
      }]))

      .then(() => store.recorded.should.eql([{
        events: [{name: 'food', payload: ['one', 'two'], time: new Date()},],
        aggregateId: 'foo',
        onRevision: 22,
        traceId: undefined
      }]))
  });

  it('reconstitutes only owning Aggregate from Events', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', {id: 'foo', baz: 'one'}), 21),
      new k.Record(new k.Event('bard', {id: 'bar', baz: 'not'}), 22),
    ];

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .initializing(function () {
          this.bards = [];
        })
        .applying('Test', 'bard', event=>event.payload.id, function (event) {
          this.bards.push(event.payload.baz);
        })
        .executing('Foo', command=>command.payload, function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.attached.should.eql([{
        aggregateId: 'foo',
      }]))

      .then(() => store.recorded.should.eql([{
        events: [{name: 'food', payload: ['one'], time: new Date()}],
        aggregateId: 'foo',
        onRevision: 21,
        traceId: undefined
      }]))
  });

  it('reconstitutes an Aggregate from a Snapshot and Events', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', 'not'), 21),
      new k.Record(new k.Event('bard', 'one'), 42)
    ];

    let snapshots = new fake.SnapshotStore();
    snapshots.snapshots = {
      foov1: new k.Snapshot(21, {bards: ['snap']})
    };

    return Domain('Test', {store, snapshots})

      .add(new k.Aggregate()
        .withVersion('v1')
        .initializing(function () {
          this.bards = ['gone'];
        })
        .applying('Test', 'bard', ()=>'foo', function (event) {
          this.bards.push(event.payload)
        })
        .executing('Foo', ()=>'foo', function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo'))

      .then(() => snapshots.fetched.should.eql([{
        id: 'foo',
        version: 'v1'
      }]))

      .then(() => store.attached.should.eql([{
        aggregateId: 'foo',
      }]))

      .then(() => store.recorded.should.eql([{
        events: [{name: 'food', payload: ['snap', 'one'], time: new Date()}],
        aggregateId: 'foo',
        onRevision: 42,
        traceId: undefined
      }]))
  });

  it('catches itself if Snapshot fetching fails', () => {
    let snapshots = new fake.SnapshotStore();
    snapshots.fetch = () => Promise.reject();

    return Domain('Test', {snapshots})

      .add(new k.Aggregate()
        .applying('Test', 'bard', ()=>'foo', ()=>null)
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))
  });

  it('keeps the reconstituted Aggregate', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', 'a '), 21)
    ];

    let snapshots = new fake.SnapshotStore();

    return Domain('Test', {store, snapshots})

      .add(new k.Aggregate()
        .initializing(function () {
          this.bards = [];
        })
        .applying('Test', 'bard', ()=>'foo', function (event) {
          this.bards.push(event.payload);
        })
        .executing('Foo', ()=>'foo', function (command) {
          return [new k.Event('food', this.bards + command.payload)]
        }))

      .execute(new k.Command('Foo', 'one'))

      .then(domain => domain.execute(new k.Command('Foo', 'two')))

      .then(() => snapshots.fetched.length.should.equal(1))

      .then(() => store.attached.length.should.equal(1))

      .then(() => store.recorded.map(r => r.events[0].payload).should.eql(['a one', 'a two']))
  });

  it('can take a Snapshot', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', 'one'), 21)
    ];

    let snapshots = new fake.SnapshotStore();

    let strategy = new fake.RepositoryStrategy()
      .onAccess(unit => unit.takeSnapshot());

    return Domain('Test', {store, snapshots, strategy})

      .add(new k.Aggregate()
        .initializing(function () {
          this.bards = [];
        })
        .withVersion('v1')
        .applying('Test', 'bard', ()=>'foo', function (event) {
          this.bards.push(event.payload);
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => snapshots.stored.should.eql([
        {id: 'foo', version: 'v1', snapshot: {head: 21, state: {bards: ['one']}}},
      ]))
  });

  it('infers Snapshot version from initializers and appliers', () => {
    let store = new fake.EventStore();

    let snapshots = new fake.SnapshotStore();

    let strategy = new fake.RepositoryStrategy()
      .onAccess(unit => unit.takeSnapshot());

    var domain = Domain('Test', {store, snapshots, strategy});

    return domain

      .add(new k.Aggregate()
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('Test', 'bard', ()=>'foo', function () {
          this.foo = 'one'
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .add(new k.Aggregate()
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('Test', 'bard', ()=>'foo', function () {
          this.foo = 'one'
        })
        .executing('Bar', ()=>'bar', ()=>null))

      .add(new k.Aggregate()
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('Test', 'bard', ()=>'foo', function () {
          this.foo = 'one'
        })
        .executing('Baz', ()=>'baz', ()=>null))

      .add(new k.Aggregate()
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('Test', 'bard', ()=>'foo', function () {
          this.foo = 'two'
        })
        .executing('Ban', ()=>'ban', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => domain.execute(new k.Command('Bar')))

      .then(() => domain.execute(new k.Command('Baz')))

      .then(() => domain.execute(new k.Command('Ban')))

      .then(() => snapshots.stored.should.eql([
        {id: 'foo', version: '4cb8fc76b08332e52b5a1755fc375cac', snapshot: {head: null, state: {foo: 'one'}}},
        {id: 'bar', version: '4cb8fc76b08332e52b5a1755fc375cac', snapshot: {head: null, state: {foo: 'one'}}},
        {id: 'baz', version: 'dd1e21624d6092437eaf422e748be7f5', snapshot: {head: null, state: {foo: 'two'}}},
        {id: 'ban', version: 'fd58504581d65f4fc63d85c9f2596c5a', snapshot: {head: null, state: {foo: 'two'}}},
      ]))
  });

  it('can unload an Aggregate', () => {
    let store = new fake.EventStore();
    store.records = [
      new k.Record(new k.Event('bard', 'one'), 21)
    ];

    let snapshots = new fake.SnapshotStore();

    let strategy = new fake.RepositoryStrategy()
      .onAccess(function (unit) {
        this.repository.remove(unit);
      });

    return Domain('Test', {store, snapshots, strategy})

      .add(new k.Aggregate()
        .initializing(function () {
          this.bards = [];
        })
        .withVersion('v1')
        .applying('Test', 'bard', ()=>'foo', function (event) {
          this.bards.push(event.payload);
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo', 'foo'))

      .then(domain => domain.execute(new k.Command('Foo')))

      .then(() => snapshots.fetched.length.should.equal(2))

      .then(() => store.attached.length.should.equal(2))

      .then(() => store.detached.should.eql([
        {aggregateId: 'foo'},
        {aggregateId: 'foo'}
      ]))
  });

  it('queues Commands per Aggregate', () => {
    var store = new (class extends fake.EventStore {
      record(events, aggregateId, onRevision, traceId) {
        return new Promise(y =>
          setTimeout(() => y(super.record(events, aggregateId, onRevision, traceId)),
            events[0].name == 'Foo' ? 30 : 0))
      }
    });

    var domain = Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'one', () => [new k.Event('Foo')])
        .executing('Bar', ()=>'one', () => [new k.Event('Bar')])
        .executing('Baz', ()=>'two', () => [new k.Event('Baz')]));

    return new Promise(y => {
      setTimeout(() => domain.execute(new k.Command('Foo')), 0);
      setTimeout(() => domain.execute(new k.Command('Bar')).then(y), 10);
      setTimeout(() => domain.execute(new k.Command('Baz')), 15);
    }).then(() =>
      store.recorded.map(p=>p.events[0].name).should.eql(['Baz', 'Foo', 'Bar']))
  });
});