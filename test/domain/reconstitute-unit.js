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
    applyFilter: event => event.payload.bla,
    requestHandler: result => [new k.Event('food', result)],
    resultChecker: expected => result => result._aggregates._store.recorded.slice(-1)
      .map(r=>r.events[0].payload).should.eql([expected]),
    fingerprint: {
      One: '95b95b780c7c562ea759817e0944ad4c',
      Three: '811b88b6d7a4f91306b19567e2b8da2e',
      Four: '615aef31d65f92763ac69ea26bb93ae0'
    }
  });

  let projection = () => ({
    unitClass: k.Projection,
    busClass: fake.EventBus,
    handleMethod: 'respondingTo',
    requestClass: k.Query,
    requestMethod: 'respondTo',
    applyFilter: 'Test',
    requestHandler: result => result,
    resultChecker: expected => result => result.should.eql(expected),
    fingerprint: {
      One: 'caaefb1eccef435364bce4ef5206276c',
      Three: 'f74656f7cb944deaafa123216a7ad067',
      Four: 'b96ee939834cc89c5b5f1518ddbd3650'
    }
  });

  [aggregate(), projection()].forEach(unit => {
    describe(unit.unitClass.name, () => {

      it('applies Events from the Bus', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'one'}), 'Test', 21),
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'two'}), 'Test', 22),
          new k.Message(new k.Event('nope', {bla: 'foo', blu: 'not'}), 'Test', 23)
        ];

        return Domain('Test', {bus})

          .add(new unit.unitClass()
            .initializing(function () {
              this.bards = [];
            })
            .applying('nothing', unit.applyFilter, function () {
              this.bards.push('never');
            })
            .applying('bard', unit.applyFilter, function (event) {
              this.bards.push('a ' + event.payload.blu);
            })
            .applying('bard', unit.applyFilter, function (event) {
              this.bards.push('b ' + event.payload.blu);
            })
            [unit.handleMethod]('Foo', request=>request.payload,
            function () {
              return unit.requestHandler(this.bards)
            }))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(unit.resultChecker(['a one', 'b one', 'a two', 'b two']))

          .then(() => bus.attached.should.eql([{
            unitId: 'foo',
          }]))
      });

      it('applies only matching Events', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'one'}), 'Test', 21),
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'not'}), 'Not', 22),
          new k.Message(new k.Event('bard', {bla: 'not', blu: 'not'}), 'Test', 23),
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'two'}), 'Test', 24),
        ];

        return Domain('Test', {bus})

          .add(new unit.unitClass()
            .initializing(function () {
              this.bards = [];
            })
            .applying('bard', unit.applyFilter, function (event) {
              if (unit.unitClass.name == k.Projection.name && event.payload.bla == 'not') return;
              this.bards.push(event.payload.blu);
            })
            [unit.handleMethod]('Foo', request=>request.payload, function () {
            return unit.requestHandler(this.bards)
          }))

          [unit.requestMethod](new unit.requestClass('Foo', 'foo'))

          .then(unit.resultChecker(['one', 'two']))

          .then(() => bus.attached.should.eql([{
            unitId: 'foo',
          }]))
      });

      it('uses a Snapshot and Events', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'not'}), 'Test', 21),
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'one'}), 'Test', 42)
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
            .applying('bard', unit.applyFilter, function (event) {
              this.bards.push(event.payload.blu)
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
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'a '}), 'Test', 21)
        ];

        let snapshots = new fake.SnapshotStore();

        let domain = Domain('Test', {bus, snapshots});

        return domain

          .add(new unit.unitClass('One')
            .initializing(function () {
              this.bards = [];
            })
            .applying('bard', unit.applyFilter, function (event) {
              this.bards.push(event.payload.blu);
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
          new k.Message(new k.Event('bard', {bla: 'foo', blu: 'one'}), 'Test', 21)
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
            .applying('bard', unit.applyFilter, function (event) {
              this.bards.push(event.payload.blu);
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
            .applying('bard', unit.applyFilter, function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Foo', ()=>'foo', ()=>null))

          .add(new unit.unitClass('Two')
            .initializing(function () {
              this.foo = 'one';
            })
            .applying('bard', unit.applyFilter, function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Bar', ()=>'bar', ()=>null))

          .add(new unit.unitClass('Three')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('bard', unit.applyFilter, function () {
              this.foo = 'one'
            })
            [unit.handleMethod]('Baz', ()=>'baz', ()=>null))

          .add(new unit.unitClass('Four')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('bard', unit.applyFilter, function () {
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
              version: unit.fingerprint.One,
              snapshot: {head: null, state: {foo: 'one'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Two',
                id: 'bar'
              },
              version: unit.fingerprint.One,
              snapshot: {head: null, state: {foo: 'one'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Three',
                id: 'baz'
              },
              version: unit.fingerprint.Three,
              snapshot: {head: null, state: {foo: 'two'}}
            },
            {
              key: {
                type: unit.unitClass.name,
                name: 'Four',
                id: 'ban'
              },
              version: unit.fingerprint.Four,
              snapshot: {head: null, state: {foo: 'two'}}
            },
          ]))
      });

      it('can unload a Unit', () => {
        let bus = new unit.busClass();
        bus.messages = [
          new k.Message('foo')
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
            .withVersion('v1')
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
