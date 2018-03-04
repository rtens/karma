const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./../fakes');
const k = require('../../src/karma');

describe('Applying Events', () => {

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

  let execute = {
    name: 'an Aggregate',
    Unit: k.Aggregate,
    Message: k.Command,
    handling: 'executing',
    handle: 'execute',
    extraReplay: 0
  };

  let respond = {
    name: 'a Projection',
    Unit: k.Projection,
    Message: k.Query,
    handling: 'respondingTo',
    handle: 'respondTo',
    extraReplay: 0
  };

  let subscribe = {
    name: 'a subscribed Projection',
    Unit: k.Projection,
    Message: k.Query,
    handling: 'respondingTo',
    handle: 'subscribeTo',
    extraReplay: 0
  };

  let react = {
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
    extraReplay: 1
  };

  [execute, respond, subscribe, react].forEach(unit => {

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

          .then(() => log.replayed[0].should.eql({streamHeads: {}}))
      });

      it('waits for the Unit to be loaded', () => {
        let history = [];
        let wait = 10;
        let log = new (class extends k.EventLog {
          replay(streamHeads, reader) {
            if (!wait) return super.replay(streamHeads, reader);

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

          .add(new unit.Unit('One')
            [unit.handling]('Foo', ()=>'foo', (payload) => history.push('handled ' + payload))))

          .then(module => new Promise(y => {
            module[unit.handle](new unit.Message('Foo', 'one')).then(y);
            module[unit.handle](new unit.Message('Foo', 'two'));
          }))

          .then(() => history.slice(0, 2).should.eql(['loading', 'loaded']))
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

          .then(() => log.replayed.length.should.equal(1 + unit.extraReplay))

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

          .then(() => log.subscriptions.slice(-1).map(s => s.active).should.eql([true]))
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

          //noinspection JSUnusedGlobalSymbols
          subscribe(subscriber) {
            history.push('subscribe');
            return super.subscribe(subscriber);
          }
        });

        log.records = [
          new k.Record(new k.Event('bard', 'one'), 'foo', 21),
          new k.Record(new k.Event('bard', 'two'), 'foo', 22),
        ];

        let applied = [];

        return Module({log})

          .add(new unit.Unit('One')
            .applying('bard', (payload) => applied.push(payload))
            [unit.handling]('Foo', $=>'foo', ()=>null))

          [unit.handle](new unit.Message('Foo'))

          .then(() => history.slice(0, 3).should.eql(['subscribe', 'subscribe', 'replay']))

          .then(() => applied.should.eql(['one', 'two', 'tre']))
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

            .then(() => log.replayed.length.should.be.least(2 + unit.extraReplay))

            .then(() => log.subscriptions.slice(-2).map(s => s.active).should.eql([false, false]))
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

            .then(() => log.replayed.slice(0, 1).should.eql([{
              streamHeads: {}
            }]))
        });
      }
    })
  })
});