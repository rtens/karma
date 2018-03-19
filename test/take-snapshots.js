const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./common/fakes');
const units = require('./common/units');
const k = require('../src/karma');

describe('Taking a Snapshot', () => {
  let _Date, Module;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;

    Module = (args = {}) =>
      new k.Module(
        args.name || 'Test',
        args.strategy || new k.UnitStrategy(),
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

  afterEach(() => {
    Date = _Date;
  });

  it('passes Module names to the SnapshotStore', () => {
    let passedNames = [];
    let persistence = new k.PersistenceFactory();
    persistence.snapshotStore = name => passedNames.push(name);

    new k.Module('Foo', new k.UnitStrategy, persistence, persistence);

    passedNames.should.eql(['Foo', 'Foo__meta']);
  });

  Object.values(units).forEach(unit =>
    describe('of ' + unit.name, () => {

      it('stores the Snapshot by key and version', () => {
        let log = new fake.EventLog();
        log.records = [
          new k.Record(new k.Event('bard', 'one'), 'foo', 21, null, new Date('2011-12-13')),
          new k.Record(new k.Event('not applied', 'not'), 'bar', 22, null, new Date('2011-12-13')),
        ];

        let snapshots = new fake.SnapshotStore();

        let taken = false;
        let strategy = {onAccess: unit => unit.takeSnapshot().then(() => taken = true)};

        return Module({log, snapshots, strategy})

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = [];
            })
            .withVersion('v1')
            .applying('bard', function (payload) {
              this.state.push(payload);
            })
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => taken.should.eql(true))

          .then(() => snapshots.stored.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: {
              lastRecordTime: new Date('2011-12-13'),
              heads: {foo: 21},
              state: ['one']
            }
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
          snapshot: new k.Snapshot(new Date('2011-12-13'), {foo: 21}, ['snap'])
        }];

        let state = [];
        return Module({log, snapshots})

          .add(new unit.Unit('One')
            .withVersion('v1')
            .initializing(function () {
              this.state = ['gone'];
            })
            .applying('bard', function (payload) {
              this.state.push(payload)
            })
            [unit.handling]('Foo', ()=>'foo', function () {
            state.push(this.state)
          }))

          [unit.handle](new unit.Message('Foo'))

          .then(() => state.should.eql([['snap', 'one']]))

          .then(() => snapshots.fetched.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: 'v1',
          }]))

          .then(() => log.replayed.map(r=>r.lastRecordTime).should.eql([new Date('2011-12-13')]))
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

        let strategy = {onAccess: unit => unit.takeSnapshot()};

        var domain = Module({snapshots, strategy});

        return domain

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = 'one';
            })
            .applying('bard', function () {
              this.state = 'one'
            })
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          .add(new unit.Unit('Two')
            .initializing(function () {
              this.state = 'one';
            })
            .applying('bard', function () {
              this.state = 'one'
            })
            [unit.handling]('Bar', ()=>'bar', ()=>null))

          .add(new unit.Unit('Three')
            .initializing(function () {
              this.state = 'two';
            })
            .applying('bard', function () {
              this.state = 'one'
            })
            [unit.handling]('Baz', ()=>'baz', ()=>null))

          .add(new unit.Unit('Four')
            .initializing(function () {
              this.state = 'two';
            })
            .applying('bard', function () {
              this.state = 'two'
            })
            [unit.handling]('Ban', ()=>'ban', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => domain[unit.handle](new unit.Message('Bar')))

          .then(() => domain[unit.handle](new unit.Message('Baz')))

          .then(() => domain[unit.handle](new unit.Message('Ban')))

          .then(() => snapshots.stored.should.eql([{
            key: unit.Unit.name + '-One-foo',
            version: '291e2ac4a7d46552cb02fdf71f132f7c',
            snapshot: {lastRecordTime: null, heads: {}, state: 'one'}
          }, {
            key: unit.Unit.name + '-Two-bar',
            version: '291e2ac4a7d46552cb02fdf71f132f7c',
            snapshot: {lastRecordTime: null, heads: {}, state: 'one'}
          }, {
            key: unit.Unit.name + '-Three-baz',
            version: '3c47bcfe065e01cf7bf92fc63df63fb8',
            snapshot: {lastRecordTime: null, heads: {}, state: 'two'}
          }, {
            key: unit.Unit.name + '-Four-ban',
            version: '31502f324858e9b8b5bec31feaca68ad',
            snapshot: {lastRecordTime: null, heads: {}, state: 'two'}
          }]))
      });

      it('saves the Snapshot if handler fails', () => {
        let _setTimeout = setTimeout;
        setTimeout = fn => fn();

        let snapshots = new fake.SnapshotStore();

        let strategy = {onAccess: unit => unit.takeSnapshot()};

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
            snapshot: {lastRecordTime: null, heads: {}, state: {}}
          }]))
      });

      if (unit.name != 'an Aggregate')
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
            snapshot: new k.Snapshot(new Date('2011-12-13'), {foo: 21, bar: 22}, ['snap'])
          }];

          let state = [];
          return Module({log, snapshots})

            .add(new unit.Unit('One')
              .withVersion('v1')
              .initializing(function () {
                this.state = ['gone'];
              })
              .applying('bard', function (payload) {
                this.state.push(payload)
              })
              [unit.handling]('Foo', ()=>'foo', function () {
              state.push(this.state)
            }))

            [unit.handle](new unit.Message('Foo'))

            .then(() => state.should.eql([['snap', 'one', 'two']]))

            .then(() => snapshots.fetched.should.eql([{
              key: unit.Unit.name + '-One-foo',
              version: 'v1',
            }]))

            .then(() => log.replayed.should.eql([{
              lastRecordTime: new Date('2011-12-13'),
              eventNames: ['bard']
            }]))
        });

      if (unit.name != 'an Aggregate')
        it('saves a Snapshot with multiple heads', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record(new k.Event('bard', 'one'), 'foo', 21, null, new Date('2011-12-13')),
            new k.Record(new k.Event('bard', 'two'), 'bar', 42, null, new Date('2011-12-14')),
          ];

          let snapshots = new fake.SnapshotStore();

          let strategy = {onAccess: unit => unit.takeSnapshot()};

          return Module({log, snapshots, strategy})

            .add(new unit.Unit('One')
              .initializing(function () {
                this.state = [];
              })
              .withVersion('v1')
              .applying('bard', function (payload) {
                this.state.push(payload);
              })
              [unit.handling]('Foo', ()=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo', 'foo'))

            .then(() => snapshots.stored.should.eql([{
              key: unit.Unit.name + '-One-foo',
              version: 'v1',
              snapshot: {
                lastRecordTime: new Date('2011-12-14'),
                heads: {foo: 21, bar: 42},
                state: ['one', 'two']
              }
            }]))
        });
    }))
});