const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../src/event');
const _unit = require('../src/unit');

const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Executing a Command', () => {
  let _Date, Domain, logger;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2011-12-13T14:15:16Z');
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
        args.strategy || new _unit.UnitStrategy(),
        logger)
  });

  afterEach(() => {
    Date = _Date;
  });

  it('fails if no executer is defined', () => {
    return Domain()

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Cannot handle Command [Foo]')

      .then(() => logger.logged['info:command']
        .map(line => 'source' in line.message ? {...line, message: {...line.message, source: '*SOURCE*'}} : line)
        .should.eql([
          {traceId: 'trace', message: {Foo: 'one'}},
          {traceId: 'trace', message: {rejected: 'COMMAND_NOT_FOUND', source: '*SOURCE*'}}
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

      .then(() => logger.logged['info:command']
        .map(line => 'source' in line.message ? {...line, message: {...line.message, source: '*SOURCE*'}} : line)
        .should.eql([
          {traceId: 'trace', message: {Foo: 'one'}},
          {traceId: 'trace', message: {rejected: 'CANNOT_MAP_MESSAGE', source: '*SOURCE*'}}
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
    let _setTimeout = setTimeout;
    setTimeout = fn => fn();

    return Domain()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          const rejection = new k.Rejection('NOPE', 'Nope');
          rejection.stack = 'Foo\nbar (my/file.js:42)\nbaz';
          throw rejection
        }))

      .execute(new k.Command('Foo', 'one').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Nope')

      .then(() => logger.logged['info:command'].should.eql([
        {traceId: 'trace', message: {Foo: 'one'}},
        {traceId: 'trace', message: {rejected: 'NOPE', source: 'my/file.js:42'}}
      ]))

      .then(() => setTimeout = _setTimeout)
  });

  it('fails if the Command handler throws an Error', () => {
    let _setTimeout = setTimeout;
    setTimeout = fn => fn();

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

      .then(() => setTimeout = _setTimeout)
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
        new _event.Record(new k.Event('food', 'one'), 'Test', 'one', 1, 'trace'),
        new _event.Record(new k.Event('bard', 'two'), 'Test', 'one', 2, 'trace'),
      ]))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        domainName: 'Test',
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
        domainName: 'Test',
        streamId: 'foo',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let _random = Math.random;
    Math.random = () => 1;

    let waits = [];

    let _setTimeout = setTimeout;
    setTimeout = (fn, wait) => {
      waits.push(wait);
      fn()
    };

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

      .then(() => setTimeout = _setTimeout)

      .then(() => count.should.equal(6))

      .then(() => waits.should.eql([12, 14, 18, 26, 42]))
  });

  it('retries recording if fails', () => {
    let store = new fake.EventStore();
    let count = 0;
    store.record = () => new Promise(y => {
      if (count++ < 5) throw new Error(count);
      y()
    });

    let _setTimeout = setTimeout;
    setTimeout = fn => fn();

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .should.not.be.rejected

      .then(() => setTimeout = _setTimeout)
  });

  it('retries if command throws and error', () => {
    let store = new fake.EventStore();
    let count = 0;

    let _setTimeout = setTimeout;
    setTimeout = fn => fn();

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => {
          if (count++ < 3) throw new Error(count);
          return []
        }))

      .execute(new k.Command('Foo').withTraceId('trace'))

      .should.not.be.rejected

      .then(() => store.recorded.should.eql([{
        events: [],
        domainName: 'Test',
        streamId: 'foo',
        onSequence: undefined,
        traceId: 'trace'
      }]))

      .then(() => chai.expect(count).to.equal(4))

      .then(() => setTimeout = _setTimeout)
  });

  it('applies only Events of Aggregate stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
      new _event.Record(new k.Event('bard', 'not'), 'Nope', 'foo', 22),
      new _event.Record(new k.Event('bard', 'not'), 'Test', 'bar', 22)
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
        domainName: 'Test',
        streamId: 'foo',
        onSequence: 21,
        traceId: undefined
      }]))

      .then(() => log.replayed.should.eql([{
        domainName: 'Test',
        streamId: 'foo'
      }]))
  });

  it('records Event with the sequence of the last event on stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new _event.Record(new k.Event('bard', 'one'), 'Test', 'foo', 21),
      new _event.Record(new k.Event('bard', 'two'), 'Test', 'foo', 22),
      new _event.Record(new k.Event('food', 'tre'), 'Test', 'foo', 23),
      new _event.Record(new k.Event('bard', 'not'), 'Nope', 'foo', 24),
      new _event.Record(new k.Event('bard', 'not'), 'Test', 'bar', 25),
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
        domainName: 'Test',
        streamId: 'foo',
        onSequence: 23,
        traceId: undefined
      }]))
  });

  it('catches errors while retrying', () => {
    let store = new fake.EventStore();
    store.record = () => new Promise(() => {
      throw new Error();
    });

    let _setTimeout = setTimeout;
    setTimeout = fn => _setTimeout(fn, 0);

    return Domain({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => {
          throw new Error('Nope');
        }))

      .execute(new k.Command('Foo'))

      .should.eventually.be.rejectedWith('Nope')

      .then(() => setTimeout = _setTimeout)
  });
});