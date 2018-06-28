const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../src/event');
const _persistence = require('../src/persistence');

const units = require('./common/units');
const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Taking a Snapshot', () => {
  let _Date, Domain;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;

    Domain = (args = {}) =>
      new k.Domain(
        args.name || 'Test',
        args.log || new fake.EventLog(),
        args.snapshots || new fake.SnapshotStore(),
        args.store || new fake.EventStore(),
        args.metaLog || new fake.EventLog(),
        args.metaSnapshots || new fake.SnapshotStore(),
        args.metaStore || new fake.EventStore(),
        args.strategy || new k.UnitStrategy())
  });

  afterEach(() => {
    Date = _Date;
  });

  Object.values(units).forEach(unit =>
    describe('of ' + unit.name, () => {

      it('stores the Snapshot by key and version', () => {
        let log = new fake.EventLog();
        log.records = [
          new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21, null, new Date('2011-12-13')),
          new _event.Record(new k.Event('not applied', 'not'), 'Test', 'bar', 22, null, new Date('2011-12-13')),
        ];

        let snapshots = new fake.SnapshotStore();

        let taken = false;
        let strategy = {onAccess: unit => unit.takeSnapshot().then(() => taken = true)};

        return Domain({log, snapshots, strategy})

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
            domainName: 'Test',
            unitKey: unit.Unit.name + '-One-foo',
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
          new _event.Record(new k.Event('bard', 'not'), 'Test', 'foo', 21),
          new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 23)
        ];

        let snapshots = new fake.SnapshotStore();
        snapshots.snapshots = [{
          domainName: 'Test',
          unitKey: unit.Unit.name + '-One-foo',
          version: 'v1',
          snapshot: new _persistence.Snapshot(new Date('2011-12-13T12:00:00'), {foo: 21}, ['snap'])
        }];

        let state = [];
        return Domain({log, snapshots})

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
            domainName: 'Test',
            unitKey: unit.Unit.name + '-One-foo',
            version: 'v1',
          }]))

          .then(() => log.replayed.map(r=>r.lastRecordTime).should.eql([new Date('2011-12-13T11:59:50')]))
      });

      it('catches itself if Snapshot fetching fails', () => {
        let snapshots = new fake.SnapshotStore();
        snapshots.fetch = () => Promise.reject();

        return Domain({snapshots})

          .add(new unit.Unit('One')
            [unit.handling]('Foo', ()=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))
      });

      it('infers Snapshot version from initializers and appliers', () => {
        let snapshots = new fake.SnapshotStore();

        let strategy = {onAccess: unit => unit.takeSnapshot()};

        var domain = Domain({snapshots, strategy});

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
            domainName: 'Test',
            unitKey: unit.Unit.name + '-One-foo',
            version: '291e2ac4a7d46552cb02fdf71f132f7c',
            snapshot: {lastRecordTime: null, heads: {}, state: 'one'}
          }, {
            domainName: 'Test',
            unitKey: unit.Unit.name + '-Two-bar',
            version: '291e2ac4a7d46552cb02fdf71f132f7c',
            snapshot: {lastRecordTime: null, heads: {}, state: 'one'}
          }, {
            domainName: 'Test',
            unitKey: unit.Unit.name + '-Three-baz',
            version: '3c47bcfe065e01cf7bf92fc63df63fb8',
            snapshot: {lastRecordTime: null, heads: {}, state: 'two'}
          }, {
            domainName: 'Test',
            unitKey: unit.Unit.name + '-Four-ban',
            version: '31502f324858e9b8b5bec31feaca68ad',
            snapshot: {lastRecordTime: null, heads: {}, state: 'two'}
          }]))
      });

      it('saves the Snapshot if handler fails', () => {
        let _setTimeout = setTimeout;
        setTimeout = fn => fn();

        let snapshots = new fake.SnapshotStore();

        let strategy = {onAccess: unit => unit.takeSnapshot()};

        return Domain({snapshots, strategy})

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
            domainName: 'Test',
            unitKey: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: {lastRecordTime: null, heads: {}, state: {}}
          }]))
      });

      if (unit.name != 'an Aggregate')
        it('reconstitutes from Snapshot and Events of multiple streams', () => {
          let log = new fake.EventLog();
          log.records = [
            new _event.Record(new k.Event('bard', 'not'), 'Test', 'foo', 21),
            new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 23),
            new _event.Record(new k.Event('bard', 'not'), 'Test', 'bar', 22),
            new _event.Record(new k.Event('bard', 'two'), 'Test', 'bar', 23),
          ];

          let snapshots = new fake.SnapshotStore();
          snapshots.snapshots = [{
            domainName: 'Test',
            unitKey: unit.Unit.name + '-One-foo',
            version: 'v1',
            snapshot: new _persistence.Snapshot(new Date('2011-12-13T12:00:00'), {foo: 21, bar: 22}, ['snap'])
          }];

          let state = [];
          return Domain({log, snapshots})

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
              domainName: 'Test',
              unitKey: unit.Unit.name + '-One-foo',
              version: 'v1',
            }]))

            .then(() => log.replayed.should.eql([{
              lastRecordTime: new Date('2011-12-13T11:59:50'),
              eventNames: ['bard']
            }]))
        });

      if (unit.name != 'an Aggregate')
        it('saves a Snapshot with multiple heads', () => {
          let log = new fake.EventLog();
          log.records = [
            new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21, null, new Date('2011-12-13')),
            new _event.Record(new k.Event('bard', 'two'), 'Test', 'bar', 42, null, new Date('2011-12-14')),
          ];

          let snapshots = new fake.SnapshotStore();

          let strategy = {onAccess: unit => unit.takeSnapshot()};

          return Domain({log, snapshots, strategy})

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
              domainName: 'Test',
              unitKey: unit.Unit.name + '-One-foo',
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