const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./common/fakes');
const units = require('./common/units');
const k = require('../src/karma');

describe('Applying Events', () => {
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

  it('passes Module names to the EventLog', () => {
    let passedNames = [];
    let persistence = new k.PersistenceFactory();
    persistence.eventLog = name => passedNames.push(name);

    new k.Module('Foo', new k.UnitStrategy, persistence, persistence);

    passedNames.should.eql(['Foo', '__admin', 'Foo__meta']);
  });

  Object.values(units).forEach(unit =>
    describe('to ' + unit.name, () => {

      it('uses recorded Events', () => {
        let log = new fake.EventLog();
        log.records = [
          new k.Record(new k.Event('bard', 'one'), 'foo', 21),
          new k.Record(new k.Event('bard', 'duplicate'), 'foo', 21),
          new k.Record(new k.Event('bard', 'two'), 'foo', 22),
          new k.Record(new k.Event('not applied', 'tre'), 'foo', 23)
        ];

        let state = [];
        return Module({log})

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = [];
            })
            .applying('no event', function () {
              this.state.push('never');
            })
            .applying('bard', function (payload) {
              this.state.push('a ' + payload);
            })
            .applying('bard', function (payload, record) {
              this.state.push('b ' + record.event.payload);
            })
            [unit.handling]('Foo', $=>$, function () {
            state.push(this.state)
          }))

          [unit.handle](new unit.Message('Foo', 'foo'))

          .then(() => state.should.eql([['a one', 'b one', 'a two', 'b two']]))

          .then(() => log.replayed.map(r=>r.lastRecordTime).should.eql([null]))
      });

      it('waits for the Unit to be loaded', () => {
        let history = [];
        let wait = 10;
        let log = new (class extends k.EventLog {
          subscribe(lastRecordTime, subscriber) {
            if (!wait) return super.subscribe(lastRecordTime, subscriber);

            history.push('loading');
            return new Promise(y => {
              setTimeout(() => {
                history.push('loaded');
                y(super.subscribe(lastRecordTime, subscriber))
              }, wait);
              wait = 0;
            });
          }
        });

        return Promise.resolve(Module({log})

          .add(new unit.Unit('One')
            [unit.handling]('Foo', ()=>'foo', () => history.push('handled'))))

          .then(module => new Promise(y => {
            module[unit.handle](new unit.Message('Foo')).then(y);
            module[unit.handle](new unit.Message('Foo'));
          }))

          .then(() => history.should.eql(['loading', 'loaded', 'handled', 'handled']))
      });

      it('keeps the reconstituted Unit', () => {
        let log = new fake.EventLog();
        log.records = [
          new k.Record(new k.Event('bard', 'a '), 'foo', 21)
        ];

        let state = [];
        let module = Module({log});
        return module

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = [];
            })
            .applying('bard', function (payload) {
              this.state.push(payload);
            })
            [unit.handling]('Foo', ()=>'foo', function (payload) {
            state.push(this.state + payload)
          }))

          [unit.handle](new unit.Message('Foo', 'one'))

          .then(() => module[unit.handle](new unit.Message('Foo', 'two')))

          .then(() => log.replayed.length.should.equal(1))

          .then(() => state.should.eql(['a one', 'a two']))
      });

      it('subscribes the Unit to the EventLog', () => {
        let log = new fake.EventLog();

        let applied = [];
        return Module({log})

          .add(new unit.Unit('One')
            .applying('bard', (payload) => applied.push(payload))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new k.Record(new k.Event('bard', 'one'), 'foo')))

          .then(() => applied.should.eql(['one']))

          .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('uses Events from combined EventLogs', () => {
        let log1 = new fake.EventLog();
        log1.records = [new k.Record(new k.Event('bard', '1a'), 'foo')];
        log1.filter = () => new fake.RecordFilter().named('one');

        let log2 = new fake.EventLog();
        log2.records = [new k.Record(new k.Event('bard', '2a'), 'foo')];
        log2.filter = () => new fake.RecordFilter().named('two');

        let applied = [];
        return Module({log: new k.CombinedEventLog([log1, log2])})

          .add(new unit.Unit('One')
            .applying('bard', (payload) => applied.push(payload))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => applied.should.eql(['1a', '2a']))

          .then(() => log1.replayed.should.eql([{
            ...{name: 'one', lastRecordTime: null},
            ...(unit.name == 'an Aggregate'
              ? {streamId: 'foo'}
              : {eventNames: ['bard']}),
          }]))
          .then(() => log2.replayed.should.eql([{
            ...{name: 'two', lastRecordTime: null},
            ...(unit.name == 'an Aggregate'
              ? {streamId: 'foo'}
              : {eventNames: ['bard']}),
          }]))

          .then(() => log1.publish(new k.Record(new k.Event('bard', '1b'), 'foo')))
          .then(() => log2.publish(new k.Record(new k.Event('bard', '2b'), 'foo')))

          .then(() => applied.should.eql(['1a', '2a', '1b', '2b']))

          .then(() => log1.subscriptions.map(s => s.active).should.eql([true]))
          .then(() => log2.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('combines Events from replaying and subscribing', () => {
        let history = [];
        let log = new class extends fake.EventLog {
          subscribe(applier) {
            history.push('subscribe');
            applier(new k.Record(new k.Event('bard', 'not'), 'foo', 22));
            applier(new k.Record(new k.Event('bard', 'tre'), 'foo', 23));

            return super.subscribe(applier);
          }

          replay(filter, applier) {
            history.push('replay');
            return super.replay(filter, applier);
          }
        };
        log.records = [
          new k.Record(new k.Event('bard', 'one'), 'foo', 21),
          new k.Record(new k.Event('bard', 'two'), 'foo', 22),
        ];

        let state = [];
        return Module({log})

          .add(new unit.Unit('One')
            .applying('bard', payload => state.push(payload))
            [unit.handling]('Foo', $=>$, ()=>null))

          [unit.handle](new unit.Message('Foo', 'foo'))

          .then(() => log.publish(new k.Record(new k.Event('bard', 'for'), 'foo', 24)))

          .then(() => history.should.eql(['subscribe', 'replay']))

          .then(() => state.should.eql(['one', 'two', 'tre', 'for']))
      });

      it('notifies the UnitStrategy', () => {
        let log = new fake.EventLog('Foobar');
        log.records = [
          new k.Record(new k.Event('bard'), 'foo')
        ];

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push(['access', unit.id])};

        let module = Module({log, strategy});
        return module

          .add(new unit.Unit('One')
            .applying('bard', ()=>notified.push('applied'))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => module[unit.handle](new unit.Message('Foo')))

          .then(() => module[unit.handle](new unit.Message('Foo')))

          .then(() => notified.filter(n=>n[1] != '__Saga-One-foo').should.eql([
            'applied',
            ['access', 'foo'],
            ['access', 'foo'],
            ['access', 'foo'],
          ]))
      });

      it('unloads the Unit if failing during replay', () => {
        let log = new fake.EventLog();
        log.records = [
          new k.Record(new k.Event('bard'), 'foo', 21),
        ];

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push('access')};

        let fail = true;
        let module = Module({log, strategy})

          .add(new unit.Unit('One')
            .applying('bard', function () {
              if (fail) throw new Error('Nope');
            })
            [unit.handling]('Foo', $=>'foo', () => notified.push('handle')));

        return module[unit.handle](new unit.Message('Foo'))

          .should.be.rejectedWith('Nope')

          .then(() => fail = false)

          .then(() => module[unit.handle](new unit.Message('Foo')))

          .then(() => notified.slice(-2).should.eql(['handle', 'access']))

          .then(() => log.replayed.length.should.equal(2))

          .then(() => log.subscriptions.map(s => s.active).should.eql([false, true]))
      });

      it('unloads the Unit if failing during subscribed Event', () => {
        let log = new fake.EventLog();

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push('access')};

        let module = Module({log, strategy})

          .add(new unit.Unit('One')
            .applying('bard', function () {
              throw new Error('Nope');
            })
            [unit.handling]('Foo', $=>'foo', () => notified.push('handle')));

        return module[unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new k.Record(new k.Event('bard', 'one'), 'foo')))

          .should.be.rejectedWith('Nope')

          .then(() => module[unit.handle](new unit.Message('Foo')))

          .then(() => notified.slice(-2).should.eql(['handle', 'access']))

          .then(() => log.replayed.length.should.equal(2))

          .then(() => log.subscriptions.map(s => s.active).should.eql([false, true]))
      });

      if (unit.name != 'a subscribed Projection')
        it('is redone if Unit is unloaded', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record(new k.Event('food', 'one'), 'foo')
          ];

          let strategy = {onAccess: unit => unit.unload()};

          let applied = [];

          let module = Module({log, strategy});
          return module

            .add(new unit.Unit('One')
              .applying('food', payload => applied.push(payload))
              [unit.handling]('Foo', ()=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo', 'foo'))

            .then(() => module[unit.handle](new unit.Message('Foo')))

            .then(() => applied.should.eql(['one', 'one']))

            .then(() => log.replayed.length.should.equal(2))

            .then(() => log.subscriptions.map(s => s.active).should.eql([false, false]))
        });

      if (unit.name != 'an Aggregate')
        it('uses recorded Events of any stream', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record(new k.Event('bard', 'one'), 'foo', 21),
            new k.Record(new k.Event('bard', 'two'), 'bar', 22),
          ];

          let applied = [];
          return Module({log})

            .add(new unit.Unit('One')
              .applying('food', ()=>null)
              .applying('bard', (payload) => applied.push(payload))
              [unit.handling]('Foo', $=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo'))

            .then(() => applied.should.eql(['one', 'two']))

            .then(() => log.replayed.should.eql([{
              lastRecordTime: null,
              eventNames: ['food', 'bard']
            }]))
        });

      if (unit.name == 'an Aggregate')
        it('uses only Events of own stream', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record(new k.Event('bard', 'one'), 'foo', 21),
            new k.Record(new k.Event('bard', 'two'), 'bar', 22),
          ];

          let applied = [];
          return Module({log})

            .add(new unit.Unit('One')
              .applying('bard', (payload) => applied.push(payload))
              [unit.handling]('Foo', $=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo'))

            .then(() => applied.should.eql(['one']))

            .then(() => log.replayed.should.eql([{
              lastRecordTime: null,
              streamId: 'foo'
            }]))
        });
    }))
});