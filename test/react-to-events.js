const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../src/event');

const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Reacting to an Event', () => {
  let _Date, Domain, logger;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2010-11-12T13:00:00Z');
    };
    Date.prototype = _Date.prototype;

    logger = new fake.Logger();

    Domain = (args = {}) =>
      new k.Domain(
        args.name || 'Test',
        args.log || new fake.EventLog(),
        args.snapshots || new fake.SnapshotStore(),
        args.store || new fake.EventStore(),
        args.metaLog || new fake.EventLog(),
        args.metaSnapshots || new fake.SnapshotStore(),
        args.metaStore || new fake.EventStore(),
        args.strategy || new k.UnitStrategy(),
        logger)
  });

  afterEach(() => {
    Date = _Date;
  });

  it('fails if a Saga has more than one reactor for the same Event', () => {
    (() => Domain()

      .add(new k.Saga('One')
        .reactingTo('food')
        .reactingTo('food')))

      .should.throw('Reaction to [food] is already defined in [One]')
  });

  it('invokes the reactor for recorded Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23),
      new _event.Record(new k.Event('food', 'two'), 'Test', 'bar', 21),
    ];

    let reactions = [];

    return Domain({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'baz', (payload, record) =>
          reactions.push([payload, record.sequence])))

      .start()

      .then(() => log.replayed.map(s=>s.lastRecordTime).should.eql([new Date(), undefined]))

      .then(() => reactions.should.eql([['one', 23], ['two', 21]]))
  });

  it('locks Reactions', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23, null, new Date('2011-12-13T14:15:16Z'))
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({log, metaStore})

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
        domainName: 'Test__meta',
        streamId: '__Saga-One-foo',
        onSequence: undefined,
        traceId: undefined
      }]))
  });

  it('records time of last Record if no reaction exists for it', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23, null, new Date('2011-12-13T14:15:16Z'))
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('not food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql([]))

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__record-consumed', {
          recordTime: new Date('2011-12-13T14:15:16Z')
        })],
        domainName: 'Test__meta',
        streamId: '__Domain-Test',
        onSequence: undefined,
        traceId: undefined
      }]))
  });

  it('does not record time of last Record already recorded', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23, null, new Date('2011-12-13T14:15:15Z'))
    ];

    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-13T14:15:16Z')}),
        '__Domain-Test')
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({log, metaStore, metaLog})

      .add(new k.Saga('One')
        .reactingTo('not food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql([]))

      .then(() => metaStore.recorded.should.eql([]))
  });

  it('subscribes to EventLog using Record time of last locked Reaction', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-11')})),
      new _event.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-13')})),
      new _event.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-12')})),
    ];

    let log = new fake.EventLog();

    return Domain({log, metaLog}).start()

      .then(() => log.replayed.should.eql([{lastRecordTime: new Date('2011-12-13')}]))
  });

  it('keeps state of last Record time', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-13')})),
    ];

    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.takeSnapshot().then(() => unit.unload())};

    let metaSnapshots = new fake.SnapshotStore();

    let domain = Domain({log, metaLog, strategy, metaSnapshots});
    return domain.start()

      .then(() => metaLog.records = [])

      .then(() => domain.start())

      .then(() => log.replayed.should.eql([
        {lastRecordTime: new Date('2011-12-13')},
        {lastRecordTime: new Date('2011-12-13')}
      ]))
  });

  it('subscribes to EventLog using time of last consumed Record', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__reaction-locked', {recordTime: new Date('2011-12-11')})),
      new _event.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-13')})),
      new _event.Record(new k.Event('__record-consumed', {recordTime: new Date('2011-12-12')})),
    ];

    let log = new fake.EventLog();

    return Domain({log, metaLog}).start()

      .then(() => log.replayed.should.eql([{lastRecordTime: new Date('2011-12-13')}]))

      .then(() => metaLog.replayed.slice(1).should.eql([{lastRecordTime: new Date('2011-12-13')}]))
  });

  it('invokes the reactor for published Events', () => {
    let log = new fake.EventLog();

    let reactions = [];

    return Domain({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload))
        .reactingTo('bard', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.publish(new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 42)))

      .then(() => reactions.should.eql(['one']))
  });

  it('invokes reactors of multiple Sagas', () => {
    let log = new fake.EventLog();

    let reactions = [];

    return Domain({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('a ' + payload)))

      .add(new k.Saga('Two')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('b ' + payload)))

      .start()

      .then(() => log.publish(new _event.Record(new k.Event('food', 'one'))))

      .then(() => reactions.should.eql(['a one', 'b one']))
  });

  it('marks throwing reactions as failed', () => {
    let log = new fake.EventLog();
    log.records = [new _event.Record(new k.Event('food', 'one'), 'Test', 'bar', 23, 'trace')];

    let metaStore = new fake.EventStore();

    return Domain({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => {
          throw {stack: 'An Error stack', toString: () => 'Error: Nope'};
        }))

      .start()

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-foo',
          recordTime: new Date(),
          streamId: 'bar',
          sequence: 23
        })],
        domainName: 'Test__meta',
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
            domainName: 'Test',
            streamId: 'bar',
            traceId: 'trace',
            time: new Date()
          },
          error: 'An Error stack'
        })],
        domainName: 'Test__meta',
        streamId: '__Saga-One-foo',
        onSequence: undefined,
        traceId: undefined
      }]))

      .then(() => logger.logged['error:Saga-One-foo'].should.eql([
        {traceId: 'trace', message: 'Error: Nope'}
      ]))
  });

  it('marks reactions with rejected Promises as failed', () => {
    let log = new fake.EventLog();
    log.records = [new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23, 'trace')];

    let metaStore = new fake.EventStore();

    return Domain({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => Promise.reject('Nope')))

      .start()

      .then(() => metaStore.recorded[1].events[0].payload.error.should.eql('Nope'))
  });

  it('logs messages from reaction', () => {
    let log = new fake.EventLog();
    log.records = [new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 23, 'trace')];

    let metaStore = new fake.EventStore();

    return Domain({log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload, record, log) => {
          log.error('An Error');
          log.info('Some Info');
          log.debug('A Bug');
        }))

      .start()

      .then(() => logger.logged['error:Saga-One-foo'].should.eql([
        {traceId: 'trace', message: 'An Error'}
      ]))
      .then(() => logger.logged['info:Saga-One-foo'].should.eql([
        {traceId: 'trace', message: 'Some Info'}
      ]))
      .then(() => logger.logged['debug:Saga-One-foo'].should.eql([
        {traceId: 'trace', message: 'A Bug'}
      ]))
  });

  it('does not invoke reactor if reaction is locked', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__reaction-locked', {streamId: 'foo', sequence: 22}), 'Test__meta', '__Saga-One-bar', 3),
    ];

    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 21)
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({metaLog, log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'Test', 'foo', 22)))

      .then(() => log.publish(new _event.Record(new k.Event('food', 'two'), 'Test', 'bar', 22)))

      .then(() => reactions.should.eql(['one', 'two']))

      .then(() => metaStore.recorded.should.eql([{
        events: [new k.Event('__reaction-locked', {
          sagaKey: '__Saga-One-bar',
          recordTime: new Date(),
          streamId: 'foo',
          sequence: 21
        })],
        domainName: 'Test__meta',
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
        domainName: 'Test__meta',
        streamId: '__Saga-One-bar',
        onSequence: 3,
        traceId: undefined
      }]))
  });

  it('keeps state of locked Reactions', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__reaction-locked', {streamId: 'foo', sequence: 22}), 'Test__meta', '__Saga-One-bar', 3),
    ];

    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.takeSnapshot().then(() => unit.unload())};

    let metaSnapshots = new fake.SnapshotStore();

    let reactions = [];

    return Domain({metaLog, log, strategy, metaSnapshots})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)))

      .start()

      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'Test', 'foo', 22)))

      .then(() => metaLog.records = [])

      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'Test', 'foo', 22)))

      .then(() => reactions.should.eql([]))
  });

  it('invokes reactor if reaction has failed after being locked', () => {
    let metaLog = new fake.EventLog();
    metaLog.records = [
      new _event.Record(new k.Event('__reaction-locked', {streamId: 'foo', sequence: 21}), 'Test__meta', '__Saga-One-bar', 3),
      new _event.Record(new k.Event('__reaction-failed', {streamId: 'foo', sequence: 21}), 'Test__meta', '__Saga-One-bar', 4),
    ];

    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('food', 'one'), 'Test', 'foo', 21)
    ];

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({metaLog, log, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)))

      .start()

      .then(() => reactions.should.eql(['one']))
  });

  it('retries reaction', () => {
    let metaLog = new fake.EventLog();

    let metaStore = new fake.EventStore();

    let reactions = [];

    return Domain({metaLog, metaStore})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)))

      .start()

      .then(() => metaLog.publish(new _event.Record(new k.Event('__reaction-retry-requested', {
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