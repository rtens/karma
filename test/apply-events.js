const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../src/karma');

describe('Applying Events', () => {
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

  it('passes Module names to the EventLog', () => {
    let passedNames = [];
    var persistence = new class extends k.PersistenceFactory {
      //noinspection JSUnusedGlobalSymbols
      eventLog(name) {
        passedNames.push(name);
      }
    };
    new k.Module('Foo', new k.RepositoryStrategy, persistence, persistence);

    passedNames.should.eql(['Foo', '__admin', 'Foo__meta']);
  });

  Object.values(units).forEach(unit =>
    describe('to ' + unit.name, () => {

      it('uses recorded Events', () => {
        let log = new fake.EventLog();
        log.records = [
          new k.Record(new k.Event('bard', 'one'), 'foo', 21),
          new k.Record(new k.Event('bard', 'two'), 'foo', 22),
          new k.Record(new k.Event('nope', 'tre'), 'foo', 23)
        ];

        let state = [];
        return Module({log})

          .add(new unit.Unit('One')
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
            [unit.handling]('Foo', $=>$, function () {
            state.push(this.bards)
          }))

          [unit.handle](new unit.Message('Foo', 'foo'))

          .then(() => state.should.eql([['a one', 'b one', 'a two', 'b two']]))

          .then(() => log.replayed.should.eql([{streamHeads: {}}]))
      });

      it('waits for the Unit to be loaded', () => {
        let history = [];
        let wait = 10;
        let log = new (class extends k.EventLog {
          subscribe(streamHeads, subscriber) {
            if (!wait) return super.subscribe(streamHeads, subscriber);

            history.push('loading');
            return new Promise(y => {
              setTimeout(() => {
                history.push('loaded');
                y(super.subscribe(streamHeads, subscriber))
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
              this.bards = [];
            })
            .applying('bard', function (payload) {
              this.bards.push(payload);
            })
            [unit.handling]('Foo', ()=>'foo', function (payload) {
            state.push(this.bards + payload)
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

      it('subscribes the Unit to multiple EventLogs', () => {
        let log1 = new fake.EventLog();
        let log2 = new fake.EventLog();

        let applied = [];
        return Module({log: log1})

          .addEventLog(log2)

          .add(new unit.Unit('One')
            .applying('bard', (payload) => applied.push(payload))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => log1.publish(new k.Record(new k.Event('bard', 'one'), 'foo')))

          .then(() => log2.publish(new k.Record(new k.Event('bard', 'two'), 'foo')))

          .then(() => applied.should.eql(['one', 'two']))

          .then(() => log1.subscriptions.map(s => s.active).should.eql([true]))

          .then(() => log2.subscriptions.map(s => s.active).should.eql([true]))
      });

      it('notifies the RepositoryStrategy', () => {
        let log = new fake.EventLog('Foobar');

        let notified = [];
        let strategy = {
          onAccess: (unit, repository) => notified.push(['access', unit.id]),
          onApply: (unit) => notified.push(['apply', unit.id])
        };

        return Module({log, strategy})

          .add(new unit.Unit('One')
            .applying('bard', ()=>null)
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => log.publish(new k.Record(new k.Event('bard', 'one'), 'foo')))

          .then(() => notified.filter(n=>n[1]!='__Saga-One-foo').should.eql([
            ['access', 'foo'],
            ['apply', 'foo']
          ]))
      });

      if (unit.name != 'a subscribed Projection') {
        it('is redone if Unit is unloaded', () => {
          let log = new fake.EventLog();
          log.records = [
            new k.Record('foo')
          ];

          let strategy = new (class extends k.RepositoryStrategy {
            //noinspection JSUnusedGlobalSymbols
            onAccess(unit, repository) {
              repository.remove(unit);
            }
          })();

          let module = Module({log, strategy});
          return module

            .add(new unit.Unit('One')
              [unit.handling]('Foo', ()=>'foo', ()=>null))

            [unit.handle](new unit.Message('Foo', 'foo'))

            .then(() => module[unit.handle](new unit.Message('Foo')))

            .then(() => log.replayed.length.should.equal(2))

            .then(() => log.subscriptions.map(s => s.active).should.eql([false, false]))
        });
      }

      if (unit.name != 'an Aggregate') {
        it('uses recorded Events of any stream', () => {
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

            .then(() => applied.should.eql(['one', 'two']))

            .then(() => log.replayed.should.eql([{streamHeads: {}}]))
        });
      }
    }))
});