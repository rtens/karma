const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./common/fakes');
const k = require('../src/karma');

describe('Executing a Command', () => {
  let _Date, _setTimeout, waits, Module;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;

    waits = [];
    _setTimeout = setTimeout;
    setTimeout = (fn, wait) => {
      waits.push(wait);
      fn()
    };

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
    setTimeout = _setTimeout;
  });

  it('passes Module names to the EventStore', () => {
    let passedNames = [];
    let persistence = new k.PersistenceFactory();
    persistence.eventStore = name => passedNames.push(name);

    new k.Module('Foo', new k.UnitStrategy, persistence, persistence);

    passedNames.should.eql(['Foo', 'Foo__meta']);
  });

  it('fails if no executer is defined', () => {
    return Module()

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Cannot handle Command [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Module()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if Aggregate has no name', () => {
    (() => Module()

      .add(new k.Aggregate()))

      .should.throw(Error, 'Please provide a name.')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo', ()=>'foo'))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Command [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', payload => {
          executed.push(payload);
        }))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(records => records.should.eql([]))

      .then(() => executed.should.eql(['one']))
  });

  it('fails if the Command is rejected', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>$, payload => [
          new k.Event('food', payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .then(records => records.should.eql([
        new k.Record(new k.Event('food', 'one'), 'one', 1, 'trace'),
        new k.Record(new k.Event('bard', 'two'), 'one', 2, 'trace'),
      ]))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        streamId: 'one',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => []))

      .execute(new k.Command('Foo').withTraceId('trace'))

      .then(() => store.recorded.should.eql([{
        events: [],
        streamId: 'foo',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let _random = Math.random;
    Math.random = () => Math.PI / 3;

    let count = 0;
    let store = new fake.EventStore();
    store.record = () => {
      count++;
      return Promise.reject(new Error('Nope'))
    };

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')

      .then(() => Math.random = _random)

      .then(() => count.should.equal(11))

      .then(() => waits.should.eql([12, 14, 18, 27, 44, 77, 144, 278, 546, 1082]))
  });

  it('retries recording if fails', () => {
    let store = new fake.EventStore();
    let count = 0;
    store.record = () => new Promise(y => {
      if (count++ < 10) throw new Error(count);
      y()
    });

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .should.not.be.rejected
  });

  it('applies only Events of Aggregate stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'not'), 'bar', 22)
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.state = [];
        })
        .applying('bard', function (payload) {
          this.state.push(payload);
        })
        .executing('Foo', $=>$, function () {
          return [new k.Event('food', this.state)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food', ['one'])],
        streamId: 'foo',
        onSequence: 21,
        traceId: undefined
      }]))

      .then(() => log.replayed.should.eql([{
        lastRecordTime: null,
        streamId: 'foo'
      }]))
  });

  it('records Event with the sequence of the last event on stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'foo', 22),
      new k.Record(new k.Event('food', 'tre'), 'foo', 23),
      new k.Record(new k.Event('bard', 'not'), 'bar', 24),
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>'foo', function () {
          return [new k.Event('food')]
        }))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food')],
        streamId: 'foo',
        onSequence: 23,
        traceId: undefined
      }]))
  });
});