const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

describe('Executing a Command', () => {

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

  let Module = (deps = {}) =>
    new k.Module(
      deps.log || new k.EventLog(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy(),
      deps.store || new k.EventStore());

  it('fails if no executer is defined', () => {
    return Module()

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Cannot handle Command [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Module()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if Aggregate has no name', () => {
    (() => Module()

      .add(new k.Aggregate()))

      .should.throw(Error, 'Please provide a name.')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo', ()=>'foo'))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Command [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', payload => {
          executed.push(payload);
        }))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql(['one']))
  });

  it('fails if the Command is rejected', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>$, payload => [
          new k.Event('food', payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        streamId: 'one',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => []))

      .execute(new k.Command('Foo', null, 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [],
        streamId: 'foo',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let store = new fake.EventStore();
    store.record = () => {
      return Promise.reject(new Error('Nope'))
    };

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

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

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('reconstitutes the Aggregate from existing Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'foo', 22),
      new k.Record(new k.Event('nope', 'tre'), 'foo', 23)
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('nothing', function () {
          this.bards.push('never');
        })
        .applying('bard', function (payload) {
          this.bards.push('a ' + payload);
        })
        .applying('bard', function (payload, record) {
          this.bards.push('b ' + record.event.payload);
        })
        .executing('Foo', $=>$, function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food', ['a one', 'b one', 'a two', 'b two'])],
        streamId: 'foo',
        onSequence: 23,
        traceId: undefined
      }]))

      .then(() => log.replayed.should.eql([{
        streamHeads: {}
      }]))
  });

  it('applies only Events of Aggregate stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'not'), 'bar', 22)
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .executing('Foo', $=>$, function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food', ['one'])],
        streamId: 'foo',
        onSequence: 21,
        traceId: undefined
      }]))

      .then(() => log.replayed.should.eql([{
        streamHeads: {}
      }]))
  });

  it('reconstitutes from Snapshot and Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'not'), 'foo', 21),
      new k.Record(new k.Event('bard', 'one'), 'foo', 23)
    ];

    let snapshots = new fake.SnapshotStore();
    snapshots.snapshots = [{
      key: 'Aggregate-One-foo',
      version: 'v1',
      snapshot: new k.Snapshot({foo: 21}, {bards: ['snap']})
    }];

    let store = new fake.EventStore();

    return Module({log, snapshots, store})

      .add(new k.Aggregate('One')
        .withVersion('v1')
        .initializing(function () {
          this.bards = ['gone'];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload)
        })
        .executing('Foo', ()=>'foo', function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food', ['snap', 'one'])],
        streamId: 'foo',
        onSequence: 23,
        traceId: undefined
      }]))

      .then(() => snapshots.fetched.should.eql([{
        key: 'Aggregate-One-foo',
        version: 'v1',
      }]))

      .then(() => log.replayed.should.eql([{
        streamHeads: {foo: 21}
      }]))
  });

  it('waits for the Aggregate to be loaded', () => {
    let history = [];
    let wait = 10;
    let log = new (class extends k.EventLog {
      replay(streamHeads, reader) {
        history.push('loading');
        return new Promise(y => {
          setTimeout(() => {
            history.push('loaded');
            y(super.replay(streamHeads, reader))
          }, wait);
          wait = 0;
        });
      }
    });

    return Promise.resolve(Module({log})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', (payload) => {
          history.push('executed ' + payload)
        })))

      .then(module => new Promise(y => {
        module.execute(new k.Command('Foo', 'one')).then(y);
        module.execute(new k.Command('Foo', 'two'));
      }))

      .then(() => history.should.eql(['loading', 'loaded', 'executed two', 'executed one']))
  });

  it('catches itself if Snapshot fetching fails', () => {
    let snapshots = new fake.SnapshotStore();
    snapshots.fetch = () => Promise.reject();

    return Module({snapshots})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))
  });

  it('keeps the reconstituted Aggregate', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'a '), 'foo', 21)
    ];

    let snapshots = new fake.SnapshotStore();

    let store = new fake.EventStore();

    let module = Module({log, snapshots, store});
    return module

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .executing('Foo', ()=>'foo', function (payload) {
          return [new k.Event('food', this.bards + payload)]
        }))

      .execute(new k.Command('Foo', 'one'))

      .then(() => module.execute(new k.Command('Foo', 'two')))

      .then(() => snapshots.fetched.length.should.equal(1))

      .then(() => log.replayed.length.should.equal(1))

      .then(() => store.recorded.map(r => r.events).should.eql([
        [new k.Event('food', 'a one')],
        [new k.Event('food', 'a two')]
      ]))
  });

  it('can take a Snapshot of the Aggregate', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21)
    ];

    let snapshots = new fake.SnapshotStore();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit) {
        unit.takeSnapshot();
      }
    })();

    return Module({log, snapshots, strategy})

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.bards = [];
        })
        .withVersion('v1')
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => snapshots.stored.should.eql([{
        key: 'Aggregate-One-foo',
        version: 'v1',
        snapshot: {heads: {foo: 21}, state: {bards: ['one']}}
      }]))
  });

  it('infers Snapshot version from initializers and appliers', () => {
    let snapshots = new fake.SnapshotStore();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit) {
        unit.takeSnapshot();
      }
    })();

    var domain = Module({snapshots, strategy});

    return domain

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .executing('Foo', ()=>'foo', ()=>null))

      .add(new k.Aggregate('Two')
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .executing('Bar', ()=>'bar', ()=>null))

      .add(new k.Aggregate('Three')
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .executing('Baz', ()=>'baz', ()=>null))

      .add(new k.Aggregate('Four')
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('bard', function () {
          this.foo = 'two'
        })
        .executing('Ban', ()=>'ban', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => domain.execute(new k.Command('Bar')))

      .then(() => domain.execute(new k.Command('Baz')))

      .then(() => domain.execute(new k.Command('Ban')))

      .then(() => snapshots.stored.should.eql([
        {
          key: 'Aggregate-One-foo',
          version: 'd3f7109eb15de9a958b25560189f7a65',
          snapshot: {heads: {}, state: {foo: 'one'}}
        },
        {
          key: 'Aggregate-Two-bar',
          version: 'd3f7109eb15de9a958b25560189f7a65',
          snapshot: {heads: {}, state: {foo: 'one'}}
        },
        {
          key: 'Aggregate-Three-baz',
          version: 'e2bf90d502a44d53425a972aa8133d5d',
          snapshot: {heads: {}, state: {foo: 'two'}}
        },
        {
          key: 'Aggregate-Four-ban',
          version: '86fad7a5e63aff46f8ffff600cb1055b',
          snapshot: {heads: {}, state: {foo: 'two'}}
        },
      ]))
  });

  it('subscribes the Aggregate to the EventLog', () => {
    let log = new fake.EventLog();

    let applied = [];

    return Module({log})

      .add(new k.Aggregate('One')
        .applying('bard', (payload) => applied.push(payload))
        .executing('Foo', $=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => log.publish(new k.Record(new k.Event('bard', 'one'), 'foo')))

      .then(() => applied.should.eql(['one']))
  });

  it('subscribes to before replaying the EventLog', () => {
    let history = [];
    let log = new (class extends fake.EventLog {
      replay(streamHeads, reader) {
        this.publish(new k.Record(new k.Event('bard', 'two'), 'foo', 22));
        this.publish(new k.Record(new k.Event('bard', 'tre'), 'foo', 23));

        history.push('replay');
        return super.replay(streamHeads, reader);
      }

      subscribe(subscriber) {
        history.push('subscribe');
        return super.subscribe(subscriber);
      }
    });
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'foo', 22),
    ];

    let store = new fake.EventStore();

    let applied = [];

    return Module({log, store})

      .add(new k.Aggregate('One')
        .applying('bard', (payload) => applied.push(payload))
        .executing('Foo', $=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => history.should.eql(['subscribe', 'replay']))

      .then(() => applied.should.eql(['one', 'two', 'tre']))
  });

  it('can unload an Aggregate', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record('foo')
    ];

    let snapshots = new fake.SnapshotStore();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit, repository) {
        repository.remove(unit);
      }
    })();

    let module = Module({log, snapshots, strategy});

    return module

      .add(new k.Aggregate('One')
        .withVersion('v1')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => module.execute(new k.Command('Foo')))

      .then(() => snapshots.fetched.length.should.equal(2))

      .then(() => log.replayed.length.should.equal(2))

      .then(() => log.subscriptions.map(s => s.active).should.eql([false, false]))
  });
});