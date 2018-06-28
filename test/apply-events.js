const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../src/event');
const _persistence = require('../src/persistence');

const units = require('./common/units');
const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Applying Events', () => {
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
    describe('to ' + unit.name, () => {

      it('uses recorded Events', () => {
        let log = new fake.EventLog();
        log.records = [
          new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
          new _event.Record(new k.Event('bard', 'duplicate'), 'Test', 'foo', 21),
          new _event.Record(new k.Event('bard', 'two'), 'Test', 'foo', 22),
          new _event.Record(new k.Event('not applied', 'Test', 'tre'), 'foo', 23)
        ];

        let state = [];
        return Domain({log})

          .add(new unit.Unit('One')
            .initializing(function () {
              state.push('first')
            })
            .initializing(function () {
              state.push('second');
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

          .then(() => state.should.eql(['first', 'second', ['a one', 'b one', 'a two', 'b two']]))

          .then(() => log.replayed.map(r=>r.lastRecordTime).should.eql([undefined]))
      });

      it('consolidates when loaded', () => {
        let log = new fake.EventLog();
        log.records = [
          new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
          new _event.Record(new k.Event('bard', 'two'), 'Test', 'foo', 22),
        ];

        let consolidated = [];
        return Domain({log})

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = [];
              this.foo = [];
            })
            .applying('bard', function (payload) {
              this.state.push(payload)
            })
            .consolidating(function () {
              this.foo = this.state.map(s => s.toUpperCase())
            })
            .consolidating(function () {
              consolidated.push(this.foo.map(s => s + '!'))
            })
            [unit.handling]('Foo', $=>$, ()=>null))

          [unit.handle](new unit.Message('Foo', 'foo'))

          .then(() => consolidated.should.eql([['ONE!', 'TWO!']]))
      });

      it('waits for the Unit to be loaded', () => {
        let history = [];
        let wait = 10;
        let log = new (class extends _persistence.EventLog {
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

        return Promise.resolve(Domain({log})

          .add(new unit.Unit('One')
            [unit.handling]('Foo', ()=>'foo', () => history.push('handled'))))

          .then(domain => new Promise(y => {
            domain[unit.handle](new unit.Message('Foo')).then(y);
            domain[unit.handle](new unit.Message('Foo'));
          }))

          .then(() => history.should.eql(['loading', 'loaded', 'handled', 'handled']))
      });

      it('keeps the reconstituted Unit', () => {
        let log = new fake.EventLog();
        log.records = [
          new _event.Record(new k.Event('bard', 'a '), 'Test', 'foo', 21)
        ];

        let state = [];
        let domain = Domain({log});

        return domain

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

          .then(() => domain[unit.handle](new unit.Message('Foo', 'two')))

          .then(() => log.replayed.length.should.equal(1))

          .then(() => state.should.eql(['a one', 'a two']))
      });

      it('subscribes the Unit to the EventLog', () => {
        let log = new fake.EventLog();

        let applied = [];
        return Domain({log})

          .add(new unit.Unit('One')
            .applying('bard', (payload) => applied.push(payload))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo')))

          .then(() => applied.should.eql(['one']))

          .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('consolidates on new Records', () => {
        let log = new fake.EventLog();

        let consolidated = [];
        return Domain({log})

          .add(new unit.Unit('One')
            .initializing(function () {
              this.state = 'Zero';
            })
            .applying('bard', function (payload) {
              this.state += payload
            })
            .consolidating(function () {
              consolidated.push(this.state)
            })
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new _event.Record(new k.Event('bard', 'One'), 'Test', 'foo')))

          .then(() => log.publish(new _event.Record(new k.Event('bard', 'Two'), 'Test', 'foo')))

          .then(() => consolidated.should.eql(['Zero', 'ZeroOne', 'ZeroOneTwo']))

          .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('notifies the UnitStrategy', () => {
        let log = new fake.EventLog('Foobar');
        log.records = [
          new _event.Record(new k.Event('bard'), 'Test', 'foo')
        ];

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push(['access', unit.id])};

        let domain = Domain({log, strategy});
        return domain

          .add(new unit.Unit('One')
            .applying('bard', ()=>notified.push('applied'))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => domain[unit.handle](new unit.Message('Foo')))

          .then(() => domain[unit.handle](new unit.Message('Foo')))

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
          new _event.Record(new k.Event('bard'), 'Test', 'foo', 21),
        ];

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push('access')};

        let fail = true;
        let domain = Domain({log, strategy})

          .add(new unit.Unit('One')
            .applying('bard', function () {
              if (fail) throw new Error('Nope');
            })
            [unit.handling]('Foo', $=>'foo', () => notified.push('handle')));

        return domain[unit.handle](new unit.Message('Foo'))

          .should.be.rejectedWith('Nope')

          .then(() => fail = false)

          .then(() => domain[unit.handle](new unit.Message('Foo')))

          .then(() => notified.slice(-2).should.eql(['handle', 'access']))

          .then(() => log.replayed.length.should.equal(2))

          .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('unloads the Unit if failing during subscribed Event', () => {
        let log = new fake.EventLog();

        let notified = [];
        let strategy = {onAccess: (unit) => notified.push('access')};

        let domain = Domain({log, strategy})

          .add(new unit.Unit('One')
            .applying('bard', function () {
              throw new Error('Nope');
            })
            [unit.handling]('Foo', $=>'foo', () => notified.push('handle')));

        return domain[unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo')))

          .should.be.rejectedWith('Nope')

          .then(() => domain[unit.handle](new unit.Message('Foo')))

          .then(() => notified.slice(-2).should.eql(['handle', 'access']))

          .then(() => log.replayed.length.should.equal(2))

          .then(() => log.subscriptions.map(s => s.active).should.eql([false, true]))
      });

      if (unit.name != 'a subscribed Projection')
        it('is redone if Unit is unloaded', () => {
          let log = new fake.EventLog();
          log.records = [
            new _event.Record(new k.Event('food', 'one'), 'Test', 'foo')
          ];

          let strategy = {onAccess: unit => unit.unload()};

          let applied = [];

          let domain = Domain({log, strategy});
          return domain

            .add(new unit.Unit('One')
              .applying('food', payload => applied.push(payload))
              [unit.handling]('Foo', ()=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo', 'foo'))

            .then(() => domain[unit.handle](new unit.Message('Foo')))

            .then(() => applied.should.eql(['one', 'one']))

            .then(() => log.replayed.length.should.equal(2))

            .then(() => log.subscriptions.map(s => s.active).should.eql([false, false]))
        });

      if (unit.name != 'an Aggregate')
        it('uses recorded Events of any stream', () => {
          let log = new fake.EventLog();
          log.records = [
            new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
            new _event.Record(new k.Event('bard', 'two'), 'Test', 'bar', 22),
          ];

          let applied = [];
          return Domain({log})

            .add(new unit.Unit('One')
              .applying('food', ()=>null)
              .applying('bard', (payload) => applied.push(payload))
              [unit.handling]('Foo', $=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo'))

            .then(() => applied.should.eql(['one', 'two']))

            .then(() => log.replayed.should.eql([{
              eventNames: ['food', 'bard']
            }]))
        });

      if (unit.name == 'an Aggregate')
        it('uses only Events of own stream', () => {
          let log = new fake.EventLog();
          log.records = [
            new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
            new _event.Record(new k.Event('bard', 'two'), 'Test', 'bar', 22),
          ];

          let applied = [];
          return Domain({log})

            .add(new unit.Unit('One')
              .applying('bard', (payload) => applied.push(payload))
              [unit.handling]('Foo', $=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo'))

            .then(() => applied.should.eql(['one']))

            .then(() => log.replayed.should.eql([{
              domainName: 'Test',
              streamId: 'foo'
            }]))
        });
    }))
});