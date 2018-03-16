const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./common/fakes');
const k = require('../src/karma');

describe('Reacting to an Event', () => {
  let _Date, Module;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2013-12-11T10:09:08Z');
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
          eventLog: module => module == '__admin'
            ? args.adminLog || new k.EventLog()
            : args.metaLog || new k.EventLog(),
          snapshotStore: () => args.metaSnapshots || new k.SnapshotStore(),
          eventStore: () => args.metaStore || new k.EventStore()
        })
  });

  afterEach(() => {
    Date = _Date;
  });

  it('fails if a Saga has more than one reactor for the same Event', () => {
    (() => Module()

      .add(new k.Saga('One')
        .reactingTo('food')
        .reactingTo('food')))

      .should.throw('Reaction to [food] is already defined in [One]')
  });

  it('invokes the reactor for recorded Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'one'), 'foo', 23),
      new k.Record(new k.Event('food', 'two'), 'bar', 21),
    ];

    let reactions = [];

    return Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.subscribed.map(s=>s.lastRecordTime).should.eql([new Date(), null]))

      .then(() => reactions.should.eql(['one', 'two']))
  });

  it('locks Reactions', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'one'), 'foo', 23, null, new Date('2011-12-13T14:15:16Z'))
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Module({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql(['one']))

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-foo',
          recordTime: new Date('2011-12-13T14:15:16Z'),
          streamId: 'foo',
          sequence: 23
        })],
        streamId: '__Saga-One-foo',
        onSequence: undefined,
        traceId: undefined
      }]))
  });

  it('records time of last Record if no reaction exists for it', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'one'), 'foo', 23, null, new Date('2011-12-13T14:15:16Z'))
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Module({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('not food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql([]))

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__record-consumed', {
          recordTime: new Date('2011-12-13T14:15:16Z')
        })],
        streamId: '__Module-Test',
        onSequence: undefined,
        traceId: undefined
      }]))
  });

  it('subscribes to EventLog using Record time of last locked Reaction', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new k.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-11')})),
      new k.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-13')})),
      new k.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-12')})),
    ];

    let log = new fake.EventLog();

    return Module({log, metaLog}).start()

      .then(() => log.subscribed.should.eql([{lastRecordTime: new Date('2011-12-13')}]))
  });

  it('subscribes to EventLog using time of last consumed Record', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new k.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-11')})),
      new k.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-13')})),
      new k.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-12')})),
    ];

    let log = new fake.EventLog();

    return Module({log, metaLog}).start()

      .then(() => log.subscribed.should.eql([{lastRecordTime: new Date('2011-12-13')}]))
  });

  it('invokes the reactor for published Events', () => {
    let log = new fake.EventLog();

    let reactions = [];

    return Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload))
        .reactingTo('bard', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.publish(new k.Record(new k.Event('food', 'one'), 'foo', 42)))

      .then(() => reactions.should.eql(['one']))
  });

  it('invokes reactors of multiple Sagas', () => {
    let log = new fake.EventLog();

    let reactions = [];

    return Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('a ' + payload)))

      .add(new k.Saga('Two')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('b ' + payload)))

      .start()

      .then(() => log.publish(new k.Record(new k.Event('food', 'one'))))

      .then(() => reactions.should.eql(['a one', 'b one']))
  });

  it('marks throwing reactions as failed', () => {
    let log = new fake.EventLog();
    log.records = [new k.Record(new k.Event('food', 'one'), 'bar', 23, 'trace')];

    let metaStore = new fake.EventStore();

    return Module({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => {
          throw {stack: 'An Error'};
        }))

      .start()

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-foo',
          recordTime: new Date(),
          streamId: 'bar',
          sequence: 23
        })],
        streamId: '__Saga-One-foo',
        onSequence: undefined,
        traceId: undefined
      }, {
        events: [new k.Event('__reaction-failed', {
          sagaId: 'foo',
          sagaKey: '__Saga-One-foo',
          record: {
            event: {name: 'food', payload: 'one', time: new Date()},
            sequence: 23,
            streamId: 'bar',
            traceId: 'trace',
            time: new Date()
          },
          error: 'An Error'
        })],
        streamId: '__Saga-One-foo',
        onSequence: undefined,
        traceId: undefined
      }]))
  });

  it('marks reactions with rejected Promises as failed', () => {
    let log = new fake.EventLog();
    log.records = [new k.Record(new k.Event('food', 'one'), 'foo', 23, 'trace')];

    let metaStore = new fake.EventStore();

    return Module({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => Promise.reject('Nope')))

      .start()

      .then(() => metaStore.recorded[1].events[0].payload.error.should.eql('Nope'))
  });

  it('does not invoke reactor if reaction is locked', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new k.Record(new k.Event('__reaction-locked', {streamId: 'foo', sequence: 22}), '__Saga-One-bar', 3),
    ];

    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'one'), 'foo', 21)
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Module({metaLog, log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.publish(new k.Record(new k.Event('food', 'not'), 'foo', 22)))

      .then(() => log.publish(new k.Record(new k.Event('food', 'two'), 'bar', 22)))

      .then(() => reactions.should.eql(['one', 'two']))

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-bar',
          recordTime: new Date(),
          streamId: 'foo',
          sequence: 21
        })],
        streamId: '__Saga-One-bar',
        onSequence: 3,
        traceId: undefined
      }, {
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-bar',
          recordTime: new Date(),
          streamId: 'bar',
          sequence: 22
        })],
        streamId: '__Saga-One-bar',
        onSequence: 3,
        traceId: undefined
      }]))
  });

  it('invokes reactor if reaction has failed after being locked', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new k.Record(new k.Event('__reaction-locked', {streamId: 'foo', sequence: 21}), '__Saga-One-bar', 3),
      new k.Record(new k.Event('__reaction-failed', {streamId: 'foo', sequence: 21}), '__Saga-One-bar', 4),
    ];

    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'one'), 'foo', 21)
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Module({metaLog, log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql(['one']))
  });

  it('retries reaction', () => {
    let adminLog = new fake.EventLog();

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Module({adminLog, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => adminLog.publish(new k.Record(new k.Event('__reaction-retry-requested', {
        sagaId: 'foo',
        sagaKey: '__Saga-One-foo',
        record: {
          event: {name: 'food', payload: 'one', time: new Date()},
          sequence: 23,
          streamId: 'bar',
          traceId: 'trace',
          time: new Date('2011-12-13')
        }
      }))))

      .then(() => reactions.should.eql(['one']))

      .then(() => metaStore.recorded.map(r=>r.events.map(e=>[e.name, e.payload])).should.eql([
        [["__reaction-locked", {
          sagaKey: '__Saga-One-foo',
          recordTime: new Date('2011-12-13'),
          sequence: 23,
          streamId: 'bar'
        }]]
      ]))
  });
});