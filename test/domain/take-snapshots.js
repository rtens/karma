const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./../fakes');
const k = require('../../src/karma');

describe('Taking a Snapshot', () => {
  let _Date, Module;

  let units = {
    execute: {
      name: 'an Aggregate',
      Unit: k.Aggregate,
      Message: k.Command,
      handling: 'executing',
      handle: 'execute',
    },
    respond: {
      name: 'a Projection',
      Unit: k.Projection,
      Message: k.Query,
      handling: 'respondingTo',
      handle: 'respondTo',
    },
    subscribe: {
      name: 'a subscribed Projection',
      Unit: k.Projection,
      Message: k.Query,
      handling: 'respondingTo',
      handle: 'subscribeTo',
    },
    react: {
      name: 'a Saga',
      Unit: k.Saga,
      Message: class extends k.Record {
        //noinspection JSUnusedGlobalSymbols
        constructor(name, payload) {
          super(new k.Event(name, payload))
        }
      },
      handling: 'reactingTo',
      handle: 'reactTo',
    }
  };

  before(() => {
    _Date = Date;
    Date = function () {
      return new _Date('2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;

    Module = (args = {}) =>
      new k.Module(
        args.name || 'Test',
        args.strategy || new k.RepositoryStrategy(),
        {
          eventLog: () => args.log || new k.EventLog(),
          snapshotStore: () => args.snapshots || new k.SnapshotStore(),
          eventStore: () => args.store || new k.EventStore()
        },
        {
          eventLog: () => args.metaLog || new k.EventLog(),
          snapshotStore: () => args.metaSnapshots || new k.SnapshotStore(),
          eventStore: () => args.metaStore || new k.EventStore()
        })
  });

  after(() => {
    Date = _Date;
  });

  it('passes Module names to the SnapshotStore', () => {
    let passedNames = [];
    var persistence = new class extends k.PersistenceFactory {
      //noinspection JSUnusedGlobalSymbols
      snapshotStore(name) {
        passedNames.push(name);
      }
    };
    new k.Module('Foo', new k.RepositoryStrategy, persistence, persistence);

    passedNames.should.eql(['Foo', 'Foo__meta']);
  });

  Object.values(units).forEach(unit =>
    describe('of ' + unit.name, () => {

      it('saves the Snapshot by key and version', () => {
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

          .add(new unit.Unit('One')
            .initializing(function () {
              this.bards = [];
            })
            .withVersion('v1')
            .applying('bard', function (payload) {
              this.bards.push(payload);
            })
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => snapshots.stored.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: {heads: {foo: 21}, state: {bards: ['one']}}
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
          key: unit.Unit.name + '-One-foo',
          version: 'v1',
          snapshot: new k.Snapshot({foo: 21}, {bards: ['snap']})
        }];

        let state = [];
        return Module({log, snapshots})

          .add(new unit.Unit('One')
            .withVersion('v1')
            .initializing(function () {
              this.bards = ['gone'];
            })
            .applying('bard', function (payload) {
              this.bards.push(payload)
            })
            [unit.handling]('Foo', ()=>'foo', function () {
            state.push(this.bards)
          }))

          [unit.handle](new unit.Message('Foo'))

          .then(() => state.should.eql([['snap', 'one']]))

          .then(() => snapshots.fetched.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
          }]))

          .then(() => log.replayed.should.eql([{
            streamHeads: {foo: 21}
          }]))
      });

      it('catches itself if Snapshot fetching fails', () => {
        let snapshots = new fake.SnapshotStore();
        snapshots.fetch = () => Promise.reject();

        return Module({snapshots})

          .add(new unit.Unit('One')
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))
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

          .add(new unit.Unit('One')
            .initializing(function () {
              this.foo = 'one';
            })
            .applying('bard', function () {
              this.foo = 'one'
            })
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          .add(new unit.Unit('Two')
            .initializing(function () {
              this.foo = 'one';
            })
            .applying('bard', function () {
              this.foo = 'one'
            })
            [unit.handling]('Bar', ()=>'bar', ()=>null))

          .add(new unit.Unit('Three')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('bard', function () {
              this.foo = 'one'
            })
            [unit.handling]('Baz', ()=>'baz', ()=>null))

          .add(new unit.Unit('Four')
            .initializing(function () {
              this.foo = 'two';
            })
            .applying('bard', function () {
              this.foo = 'two'
            })
            [unit.handling]('Ban', ()=>'ban', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => domain[unit.handle](new unit.Message('Bar')))

          .then(() => domain[unit.handle](new unit.Message('Baz')))

          .then(() => domain[unit.handle](new unit.Message('Ban')))

          .then(() => snapshots.stored.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'b16fcb72b0dfffc93af957c61bf1105b',
            snapshot: {heads: {}, state: {foo: 'one'}}
          }, {
            key: unit.Unit.name + '-Two-bar',
            version: 'b16fcb72b0dfffc93af957c61bf1105b',
            snapshot: {heads: {}, state: {foo: 'one'}}
          }, {
            key: unit.Unit.name + '-Three-baz',
            version: 'e0deac31cb640f25e89614c48a0f370e',
            snapshot: {heads: {}, state: {foo: 'two'}}
          }, {
            key: unit.Unit.name + '-Four-ban',
            version: '05f2c32b673bbd8641329a4866ea54bf',
            snapshot: {heads: {}, state: {foo: 'two'}}
          }]))
      });

      it('saves the Snapshot if handler fails', () => {
        let _setTimeout = setTimeout;
        setTimeout = fn => fn();

        let snapshots = new fake.SnapshotStore();

        let strategy = new (class extends k.RepositoryStrategy {
          //noinspection JSUnusedGlobalSymbols
          onAccess(unit) {
            unit.takeSnapshot();
          }
        })();

        return Module({snapshots, strategy})

          .add(new unit.Unit('One')
            .withVersion('v1')
            [unit.handling]('Foo', ()=>'foo',
            () => {
              throw new Error('Nope')
            }))

          [unit.handle](new unit.Message('Foo'))

          .catch(()=>null)

          .then(() => setTimeout = _setTimeout)

          .then(() => snapshots.stored.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: {heads: {}, state: {}}
          }]))
      });

      if (unit.name != 'an Aggregate') {
        it('reconstitutes from Snapshot and Events of multiple streams', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record(new k.Event('bard', 'not'), 'foo', 21),
            new k.Record(new k.Event('bard', 'one'), 'foo', 23),
            new k.Record(new k.Event('bard', 'not'), 'bar', 22),
            new k.Record(new k.Event('bard', 'two'), 'bar', 23),
          ];

          let snapshots = new fake.SnapshotStore();
          snapshots.snapshots = [{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: new k.Snapshot({foo: 21, bar: 22}, {bards: ['snap']})
          }];

          let state = [];
          return Module({log, snapshots})

            .add(new unit.Unit('One')
              .withVersion('v1')
              .initializing(function () {
                this.bards = ['gone'];
              })
              .applying('bard', function (payload) {
                this.bards.push(payload)
              })
              [unit.handling]('Foo', ()=>'foo', function () {
              state.push(this.bards)
            }))

            [unit.handle](new unit.Message('Foo'))

            .then(() => state.should.eql([['snap', 'one', 'two']]))

            .then(() => snapshots.fetched.should.eql([{
              key: unit.Unit.name + '-One-foo',
              version: 'v1',
            }]))

            .then(() => log.replayed.should.eql([{
              streamHeads: {foo: 21, bar: 22}
            }]))
        });

        it('saves a Snapshot with multiple heads', () => {
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

            .add(new unit.Unit('One')
              .initializing(function () {
                this.bards = [];
              })
              .withVersion('v1')
              .applying('bard', function (payload) {
                this.bards.push(payload);
              })
              [unit.handling]('Foo', ()=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo', 'foo'))

            .then(() => snapshots.stored.should.eql([{
              key: unit.Unit.name + '-One-foo',
              version: 'v1',
              snapshot: {heads: {foo: 21, bar: 42}, state: {bards: ['one', 'two']}}
            }]))
        });
      }
    }))
});