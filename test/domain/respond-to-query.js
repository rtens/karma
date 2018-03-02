const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

describe('Responding to a Query', () => {

  let Module = (deps = {}) =>
    new k.Module(
      deps.log || new k.EventLog(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy(),
      deps.store || new k.EventStore());

  it('fails if no responder exists for that Query', () => {
    (() => Module()

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot handle [Foo]')
  });

  it('fails if multiple responders exist for that Query in one Projection', () => {
    (() => Module()

      .add(new k.Projection('One')
        .respondingTo('Foo')
        .respondingTo('Foo')))

      .should.throw(Error, '[One] is already responding to [Foo]')
  });

  it('fails if multiple responders exist for that Query across Projections', () => {
    (() => Module()

      .add(new k.Projection('One')
        .respondingTo('Foo'))

      .add(new k.Projection('Two')
        .respondingTo('Foo'))

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Too many handlers for [Foo]: [One, Two]')
  });

  it('fails if the Query cannot be mapped to a Projection instance', () => {
    (() => Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>null))

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('returns a value', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', payload => 'foo' + payload))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('foobar')
  });

  it('may return a promise', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', (payload)=>Promise.resolve(payload)))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('bar')
  });

  it('fails if the Query is rejected', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', () => {
          throw new Error('Nope')
        }))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.be.rejectedWith('Nope')
  });

  it('reconstitutes the Projection from Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'bar', 22),
      new k.Record(new k.Event('nope', 'not'), 'baz', 23)
    ];

    return Module({log})

      .add(new k.Projection('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('nothing', function () {
          this.bards.push('never');
        })
        .applying('bard', function (payload) {
          this.bards.push('a ' + payload);
        })
        .applying('bard', function (payload, event) {
          this.bards.push('b ' + event.payload);
        })
        .respondingTo('Foo', $=>$, function () {
          return this.bards
        }))

      .respondTo(new k.Query('Foo', 'foo'))

      .then(result => result.should.eql(['a one', 'b one', 'a two', 'b two']))

      .then(() => log.subscribed.should.eql([{
        subscriptionId: 'Projection-One-foo',
        streamHeads: {}
      }]))
  });

  it('reconstitutes from Snapshot and Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'not'), 'foo', 21),
      new k.Record(new k.Event('bard', 'one'), 'foo', 23),
      new k.Record(new k.Event('bard', 'not'), 'bar', 22),
      new k.Record(new k.Event('bard', 'two'), 'bar', 23),
    ];

    let snapshots = new fake.SnapshotStore();
    snapshots.snapshots = [{
      key: 'Projection-One-foo',
      version: 'v1',
      snapshot: new k.Snapshot({foo: 21, bar: 22}, {bards: ['snap']})
    }];

    return Module({log, snapshots})

      .add(new k.Projection('One')
        .withVersion('v1')
        .initializing(function () {
          this.bards = ['gone'];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload)
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.bards
        }))

      .respondTo(new k.Query('Foo'))

      .then(result => result.should.eql(['snap', 'one', 'two']))

      .then(() => snapshots.fetched.should.eql([{
        key: 'Projection-One-foo',
        version: 'v1',
      }]))

      .then(() => log.subscribed.should.eql([{
        subscriptionId: 'Projection-One-foo',
        streamHeads: {foo: 21, bar: 22}
      }]))
  });

  it('waits for the Projection to be loaded', () => {
    let history = [];
    let wait = 10;
    let log = new (class extends k.EventLog {
      subscribe(subscriptionId, streamHeads, subscriber) {
        history.push('loading');
        return new Promise(y => {
          setTimeout(() => {
            history.push('loaded');
            y(super.subscribe(subscriptionId, streamHeads, subscriber))
          }, wait);
          wait = 0;
        });
      }
    });

    return Promise.resolve(Module({log})

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', (payload) => {
          history.push(payload)
        })))

      .then(module => new Promise(y => {
        module.respondTo(new k.Query('Foo', 'one')).then(y);
        module.respondTo(new k.Query('Foo', 'two'));
      }))

      .then(() => history.should.eql(['loading', 'loaded', 'two', 'one']))
  });

  it('catches itself if Snapshot fetching fails', () => {
    let snapshots = new fake.SnapshotStore();
    snapshots.fetch = () => Promise.reject();

    return Module({snapshots})

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .respondTo(new k.Query('Foo'))
  });

  it('keeps the reconstituted Projection', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'a '), 'foo', 21)
    ];

    let snapshots = new fake.SnapshotStore();

    let module = Module({log, snapshots});
    return module

      .add(new k.Projection('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .respondingTo('Foo', ()=>'foo', function (payload) {
          return this.bards + payload
        }))

      .respondTo(new k.Query('Foo', 'one'))

      .then(result => result.should.eql('a one'))

      .then(() => module.respondTo(new k.Query('Foo', 'two')))

      .then(result => result.should.eql('a two'))

      .then(() => snapshots.fetched.length.should.equal(1))

      .then(() => log.subscribed.length.should.equal(1))
  });

  it('can take a Snapshot of the Projection', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'bar', 42),
    ];

    let snapshots = new fake.SnapshotStore();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit) {
        unit.takeSnapshot();
      }
    })();

    return Module({log, snapshots, strategy})

      .add(new k.Projection('One')
        .initializing(function () {
          this.bards = [];
        })
        .withVersion('v1')
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .respondTo(new k.Query('Foo', 'foo'))

      .then(() => snapshots.stored.should.eql([{
        key: 'Projection-One-foo',
        version: 'v1',
        snapshot: {heads: {foo: 21, bar: 42}, state: {bards: ['one', 'two']}}
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

      .add(new k.Projection('One')
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .add(new k.Projection('Two')
        .initializing(function () {
          this.foo = 'one';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .respondingTo('Bar', ()=>'bar', ()=>null))

      .add(new k.Projection('Three')
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('bard', function () {
          this.foo = 'one'
        })
        .respondingTo('Baz', ()=>'baz', ()=>null))

      .add(new k.Projection('Four')
        .initializing(function () {
          this.foo = 'two';
        })
        .applying('bard', function () {
          this.foo = 'two'
        })
        .respondingTo('Ban', ()=>'ban', ()=>null))

      .respondTo(new k.Query('Foo'))

      .then(() => domain.respondTo(new k.Query('Bar')))

      .then(() => domain.respondTo(new k.Query('Baz')))

      .then(() => domain.respondTo(new k.Query('Ban')))

      .then(() => snapshots.stored.should.eql([
        {
          key: 'Projection-One-foo',
          version: 'd3f7109eb15de9a958b25560189f7a65',
          snapshot: {heads: {}, state: {foo: 'one'}}
        },
        {
          key: 'Projection-Two-bar',
          version: 'd3f7109eb15de9a958b25560189f7a65',
          snapshot: {heads: {}, state: {foo: 'one'}}
        },
        {
          key: 'Projection-Three-baz',
          version: 'e2bf90d502a44d53425a972aa8133d5d',
          snapshot: {heads: {}, state: {foo: 'two'}}
        },
        {
          key: 'Projection-Four-ban',
          version: '86fad7a5e63aff46f8ffff600cb1055b',
          snapshot: {heads: {}, state: {foo: 'two'}}
        },
      ]))
  });

  it('can unload a Projection', () => {
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

    let domain = Module({log, snapshots, strategy});

    return domain

      .add(new k.Projection('One')
        .withVersion('v1')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .respondTo(new k.Query('Foo', 'foo'))

      .then(() => domain.respondTo(new k.Query('Foo')))

      .then(() => snapshots.fetched.length.should.equal(2))

      .then(() => log.subscribed.length.should.equal(2))

      .then(() => log.cancelled.should.eql([
        {subscriptionId: 'Projection-One-foo'},
        {subscriptionId: 'Projection-One-foo'},
      ]))
  });
})
;