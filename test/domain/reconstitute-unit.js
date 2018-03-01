const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

describe('Reconstituting a/an', () => {

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
      deps.bus || new k.EventStore(),
      deps.bus || new k.EventBus(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy());

  let aggregate = () => ({
    unitClass: k.Aggregate,
    busClass: fake.EventStore,
    handleMethod: 'executing',
    requestClass: k.Command,
    requestMethod: 'execute',
    requestHandler: result => [new k.Event('food', result)],
    resultChecker: expected => result => result._aggregates._store.recorded.slice(-1)
      .map(r=>r.events[0].payload).should.eql([expected])
  });

  let repository = () => ({
    unitClass: k.Projection,
    busClass: fake.EventBus,
    handleMethod: 'respondingTo',
    requestClass: k.Query,
    requestMethod: 'respondTo',
    requestHandler: result => result,
    resultChecker: expected => result => result.should.eql(expected)
  });

  [aggregate(), repository()].forEach(unit => {
    describe(unit.unitClass.name, () => {

      it('applies Events from the Bus', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'one'), 'Test', 21),
          new k.Message(new k.Event('bard', 'two'), 'Test', 22),
          new k.Message(new k.Event('nope', 'not'), 'Test', 23)
        ];

        return Domain('Test', {bus})

          .add(new unit.unitClass()
            .initializing(function () {
              this.bards = [];
            })
            .applying('Test', 'nothing', ()=>null)
            .applying('Test', 'bard', function (event) {
              this.bards.push(event.payload);
            })
            [unit.handleMethod]('Foo', request=>request.payload,
            function () {
              return unit.requestHandler(this.bards)
            }))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(unit.resultChecker(['one', 'two']))

          .then(() => bus.attached.should.eql([{
            unitId: 'foo',
          }]))
      });

      it('applies only Events from same Domain', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'one'), 'One', 21),
          new k.Message(new k.Event('bard', 'not'), 'Not', 22),
          new k.Message(new k.Event('bard', 'two'), 'Two', 23),
        ];

        return Domain('Test', {bus})

          .add(new unit.unitClass()
            .initializing(function () {
              this.bards = [];
            })
            .applying('One', 'bard', function (event) {
              this.bards.push('One ' + event.payload);
            })
            .applying('Two', 'bard', function (event) {
              this.bards.push('Two ' + event.payload);
            })
            [unit.handleMethod]('Foo', request=>request.payload, function () {
            return unit.requestHandler(this.bards)
          }))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(unit.resultChecker(['One one', 'Two two']))

          .then(() => bus.attached.should.eql([{
            unitId: 'foo',
          }]))
      });

      it('uses a Snapshot and Events', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'not'), 'Test', 21),
          new k.Message(new k.Event('bard', 'one'), 'Test', 42)
        ];

        let snapshots = new fake.SnapshotStore();
        snapshots.snapshots = [{
          key: {type: unit.unitClass.name, name: 'One', id: 'foo'},
          version: 'v1',
          snapshot: new k.Snapshot(21, {bards: ['snap']})
        }];

        return Domain('Test', {bus, snapshots})

          .add(new unit.unitClass('One')
            .withVersion('v1')
            .initializing(function () {
              this.bards = ['gone'];
            })
            .applying('Test', 'bard', function (event) {
              this.bards.push(event.payload)
            })
            [unit.handleMethod]('Foo', ()=>'foo', function () {
            return unit.requestHandler(this.bards)
          }))

          [unit.requestMethod](new unit.requestClass('Foo'))

          .then(unit.resultChecker(['snap', 'one']))

          .then(() => snapshots.fetched.should.eql([{
            key: {
              type: unit.unitClass.name,
              name: 'One',
              id: 'foo'
            },
            version: 'v1',
          }]))

          .then(() => bus.attached.should.eql([{
            unitId: 'foo',
          }]))
      });

      it('catches itself if Snapshot fetching fails', () => {
        let snapshots = new fake.SnapshotStore();
        snapshots.fetch = () => Promise.reject();

        return Domain('Test', {snapshots})

          .add(new unit.unitClass()
            [unit.handleMethod]('Foo', ()=>'foo', ()=>null))

          [unit.requestMethod](new unit.requestClass('Foo'))
      });

      it('keeps the reconstituted Unit', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'a '), 'Test', 21)
        ];

        let snapshots = new fake.SnapshotStore();

        let domain = Domain('Test', {bus, snapshots});

        return domain

          .add(new unit.unitClass('One')
            .initializing(function () {
              this.bards = [];
            })
            .applying('Test', 'bard', function (event) {
              this.bards.push(event.payload);
            })
            [unit.handleMethod]('Foo', ()=>'foo', function (request) {
            return unit.requestHandler(this.bards + request.payload)
          }))

          [unit.requestMethod](new unit.requestClass('Foo', 'one'))

          .then(unit.resultChecker('a one'))

          .then(() => domain[unit.requestMethod](new unit.requestClass('Foo', 'two')))

          .then(unit.resultChecker('a two'))

          .then(() => snapshots.fetched.length.should.equal(1))

          .then(() => bus.attached.length.should.equal(1))
      });

      it('can take a Snapshot of the Unit', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'one'), 'Test', 21)
        ];

        let snapshots = new fake.SnapshotStore();

        let strategy = new (class extends k.RepositoryStrategy {
          onAccess(repository, unit) {
            unit.takeSnapshot();
          }
        })();

        return Domain('Test', {bus, snapshots, strategy})

          .add(new unit.unitClass('One')
            .initializing(function () {
              this.bards = [];
            })
            .withVersion('v1')
            .applying('Test', 'bard', function (event) {
              this.bards.push(event.payload);
            })
            [unit.handleMethod]('Foo', ()=>'foo', ()=>null))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(() => snapshots.stored.should.eql([{
            key: {
              type: unit.unitClass.name,
              name: 'One',
              id: 'foo'
            },
            version: 'v1',
            snapshot: {head: 21, state: {bards: ['one']}}
          }]))
      });

      it('infers Snapshot version from initializers and appliers', () => {
        let bus = new unit.busClass();

        let snapshots = new fake.SnapshotStore();

        let strategy = new (class extends k.RepositoryStrategy {
          onAccess(repository, unit) {
            unit.takeSnapshot();
          }
        })();

        var domain = Domain('Test', {bus, snapshots, strategy});

        return domain

          .add(new unit.unitClass('One')
            .initializing(function () {
              this.foo = 'one';
            })
            .applying('Test', 'bard', function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Foo', ()=>'foo', ()=>null))

          .add(new unit.unitClass('Two')
            .initializing(function () {
              this.foo = 'one';
            })
            .applying('Test', 'bard', function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Bar', ()=>'bar', ()=>null))

          .add(new unit.unitClass('Three')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('Test', 'bard', function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Baz', ()=>'baz', ()=>null))

          .add(new unit.unitClass('Four')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('Test', 'bard', function () {
              this.foo = 'two'
            })
            [unit.handleMethod]('Ban', ()=>'ban', ()=>null))

          [unit.requestMethod](new unit.requestClass('Foo'))

          .then(() => domain[unit.requestMethod](new unit.requestClass('Bar')))

          .then(() => domain[unit.requestMethod](new unit.requestClass('Baz')))

          .then(() => domain[unit.requestMethod](new unit.requestClass('Ban')))

          .then(() => snapshots.stored.should.eql([
            {
              key: {
                type: unit.unitClass.name,
                name: 'One',
                id: 'foo'
              },
              version: 'caaefb1eccef435364bce4ef5206276c',
              snapshot: {head: null, state: {foo: 'one'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Two',
                id: 'bar'
              },
              version: 'caaefb1eccef435364bce4ef5206276c',
              snapshot: {head: null, state: {foo: 'one'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Three',
                id: 'baz'
              },
              version: 'f74656f7cb944deaafa123216a7ad067',
              snapshot: {head: null, state: {foo: 'two'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Four',
                id: 'ban'
              },
              version: 'b96ee939834cc89c5b5f1518ddbd3650',
              snapshot: {head: null, state: {foo: 'two'}}
            },
          ]))
      });

      it('can unload a Unit', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', 'one'), 21)
        ];

        let snapshots = new fake.SnapshotStore();

        let strategy = new (class extends k.RepositoryStrategy {
          onAccess(repository, unit) {
            repository.remove(unit);
          }
        })();

        let domain = Domain('Test', {bus, snapshots, strategy});

        return domain

          .add(new unit.unitClass()
            .initializing(function () {
              this.bards = [];
            })
            .withVersion('v1')
            .applying('Test', 'bard', function (event) {
              this.bards.push(event.payload);
            })
            [unit.handleMethod]('Foo', ()=>'foo', ()=>null))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(() => domain[unit.requestMethod](new unit.requestClass('Foo')))

          .then(() => snapshots.fetched.length.should.equal(2))

          .then(() => bus.attached.length.should.equal(2))

          .then(() => bus.detached.should.eql([
            {unitId: 'foo'},
            {unitId: 'foo'}
          ]))
      });
    })
  })
});
