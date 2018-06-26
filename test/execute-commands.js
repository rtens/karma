const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../src/event');
const _persistence = require('../src/persistence');
const _unit = require('../src/unit');

const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Executing a Command', () => {
  let _Date, _setTimeout, waits, Domain, logger;

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

    logger = new fake.Logger();

    Domain = (args = {}) =>
      new k.Domain(
        args.name || 'Test',
        {
          eventLog: () => args.log || new fake.EventLog(),
          snapshotStore: () => args.snapshots || new fake.SnapshotStore(),
          eventStore: () => args.store || new fake.EventStore()
        },
        {
          eventLog: () => args.metaLog || new fake.EventLog(),
          snapshotStore: () => args.metaSnapshots || new fake.SnapshotStore(),
          eventStore: () => args.metaStore || new fake.EventStore()
        },
        args.strategy || new _unit.UnitStrategy(),
        logger)
  });

  afterEach(() => {
    Date = _Date;
    setTimeout = _setTimeout;
  });

  it('passes Domain names to the EventStore', () => {
    let passedNames = [];
    let persistence = new _persistence.PersistenceFactory();
    persistence.eventStore = name => passedNames.push(name);

    new k.Domain('Foo', persistence, persistence);

    passedNames.should.eql(['Foo', 'Foo__meta']);
  });

  it('fails if no executer is defined', () => {
    return Domain()

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Cannot handle Command [Foo]')

      .then(() => logger.logged['info:command'].should.eql([
        {traceId: 'trace', message: {Foo: 'one'}},
        {traceId: 'trace', message: {rejected: 'COMMAND_NOT_FOUND'}}
      ]))
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if Aggregate has no name', () => {
    (() => Domain()

      .add(new k.Aggregate()))

      .should.throw(Error, 'Please provide a name.')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo', ()=>'foo'))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Command [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Cannot map [Foo]')

      .then(() => logger.logged['info:command'].should.eql([
        {traceId: 'trace', message: {Foo: 'one'}},
        {traceId: 'trace', message: {rejected: 'CANNOT_MAP_MESSAGE'}}
      ]))
  });

  it('executes the Command', () => {
    let executed = [];

    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', (payload, command) => {
          executed.push([payload, command.traceId]);
        }))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .then(records => records.should.eql([]))

      .then(() => executed.should.eql([['one', 'trace']]))

      .then(() => logger.logged['info:command'].should.eql([
        {traceId: 'trace', message: {Foo: 'one'}},
        {traceId: 'trace', message: {executed: 'Foo'}}
      ]))
  });

  it('logs messages from Command handler', () => {
    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', (payload, command, log) => {
          log.error('An Error');
          log.info('Some Info');
          log.debug('A Bug');
        }))

      .execute(new k.Command('Foo').withTraceId('trace'))

      .then(() => logger.logged['error:Aggregate-One-foo'].should.eql([
        {traceId: 'trace', message: 'An Error'}
      ]))
      .then(() => logger.logged['info:Aggregate-One-foo'].should.eql([
        {traceId: 'trace', message: 'Some Info'}
      ]))
      .then(() => logger.logged['debug:Aggregate-One-foo'].should.eql([
        {traceId: 'trace', message: 'A Bug'}
      ]))
  });

  it('fails if the Command is rejected', () => {
    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          throw new k.Rejection('NOPE', 'Nope')
        }))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Nope')

      .then(() => logger.logged['info:command'].should.eql([
        {traceId: 'trace', message: {Foo: 'one'}},
        {traceId: 'trace', message: {rejected: 'NOPE'}}
      ]))
  });

  it('fails if the Command handler throws an Error', () => {
    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(Error, 'Nope')

      .then(() => logger.logged['error:command'].should.eql([
        {traceId: 'trace', message: 'Error: Nope'}
      ]))
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>$, payload => [
          new k.Event('food', payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .then(records => records.should.eql([
        new _event.Record(new k.Event('food', 'one'), 'one', 1, 'trace'),
        new _event.Record(new k.Event('bard', 'two'), 'one', 2, 'trace'),
      ]))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        streamId: 'one',
        onSequence: undefined,
        traceId: 'trace'
      }]))

      .then(() => logger.logged['info:event'].should.eql([
        {traceId: 'trace', message: {food: 'one'}},
        {traceId: 'trace', message: {bard: 'two'}}
      ]))
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Domain({store})

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

    return Domain({store})

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

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .should.not.be.rejected
  });

  it('applies only Events of Aggregate stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('bard', 'one'), 'foo', 21),
      new _event.Record(new k.Event('bard', 'not'), 'bar', 22)
    ];

    let store = new fake.EventStore();

    return Domain({log, store})

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
        streamId: 'foo'
      }]))
  });

  it('records Event with the sequence of the last event on stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('bard', 'one'), 'foo', 21),
      new _event.Record(new k.Event('bard', 'two'), 'foo', 22),
      new _event.Record(new k.Event('food', 'tre'), 'foo', 23),
      new _event.Record(new k.Event('bard', 'not'), 'bar', 24),
    ];

    let store = new fake.EventStore();

    return Domain({log, store})

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