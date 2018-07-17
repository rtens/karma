const chai = require('chai');
const promised = require('chai-as-promised');
const should = chai.should();
chai.use(promised);

const _event = require('../src/event');
const _unit = require('../src/unit');

const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Responding to a Query', () => {
  let Domain, logger;

  beforeEach(() => {
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

  it('fails if no responder exists for that Query', () => {
    return Domain()

      .respondTo(new k.Query('Foo', 'bar').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Cannot handle Query [Foo]')

      .then(() => logger.logged['info:query']
        .map(line => 'source' in line.message ? {...line, message: {...line.message, source: '*SOURCE*'}} : line)
        .should.eql([
          {traceId: 'trace', message: {Foo: 'bar'}},
          {traceId: 'trace', message: {rejected: 'QUERY_NOT_FOUND', source: '*SOURCE*'}},
        ]))
  });

  it('fails if multiple responders exist for that Query in one Projection', () => {
    (() => Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo')
        .respondingTo('Foo')))

      .should.throw(Error, '[One] is already responding to [Foo]')
  });

  it('fails if multiple responders exist for that Query across Projections', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo'))

      .add(new k.Projection('Two')
        .respondingTo('Foo', ()=>'foo'))

      .respondTo(new k.Query('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Query [Foo]')
  });

  it('fails if the Query cannot be mapped to a Projection instance', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>null))

      .respondTo(new k.Query('Foo', 'bar').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Cannot map [Foo]')

      .then(() => logger.logged['info:query']
        .map(line => 'source' in line.message ? {...line, message: {...line.message, source: '*SOURCE*'}} : line)
        .should.eql([
          {traceId: 'trace', message: {Foo: 'bar'}},
          {traceId: 'trace', message: {rejected: 'CANNOT_MAP_MESSAGE', source: '*SOURCE*'}},
        ]))
  });

  it('returns a value', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', (payload, query) => 'foo' + payload + query.traceId))

      .respondTo(new k.Query('Foo', 'bar').withTraceId('trace'))

      .should.eventually.equal('foobartrace')

      .then(() => logger.logged['info:query'].should.eql([
        {traceId: 'trace', message: {Foo: 'bar'}},
        {traceId: 'trace', message: {responded: 'Foo'}}
      ]))
  });

  it('may return a promise', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', payload => Promise.resolve(payload)))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('bar')
  });

  it('logs message from Query responder', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', (payload, query, log) => {
          log.error('An Error');
          log.info('Some Info');
          log.debug('A Bug');
        }))

      .respondTo(new k.Query('Foo', 'bar').withTraceId('trace'))

      .then(() => logger.logged['error:Projection-One-foo'].should.eql([
        {traceId: 'trace', message: 'An Error'}
      ]))
      .then(() => logger.logged['info:Projection-One-foo'].should.eql([
        {traceId: 'trace', message: 'Some Info'}
      ]))
      .then(() => logger.logged['debug:Projection-One-foo'].should.eql([
        {traceId: 'trace', message: 'A Bug'}
      ]))
  });

  it('fails if the Query is rejected', () => {
    return Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', () => {
          const rejection = new k.Rejection('NOPE', 'Not good');
          rejection.stack = 'Foo\nbar (my/file.js:42)\nbaz';
          throw rejection
        }))

      .respondTo(new k.Query('Foo', 'bar').withTraceId('trace'))

      .should.be.rejectedWith(k.Rejection, 'Not good')

      .then(() => logger.logged['info:query']
        .should.eql([
          {traceId: 'trace', message: {Foo: 'bar'}},
          {traceId: 'trace', message: {rejected: 'NOPE', source: 'my/file.js:42'}}
        ]))
  });

  it('can be delayed until Projection reaches stream heads', () => {
    let response = null;

    let log = new fake.EventLog();

    let applied;
    let domain = Domain({log})
      .add(new k.Projection('One')
        .applying('food', payload => applied = payload)
        .respondingTo('Foo', ()=>'foo', () => applied + ' later'));

    let promise = domain.respondTo(new k.Query('Foo').waitFor({One: {bar: 42, baz: 42}}))
      .then(r => response = r);

    return new Promise(y => setTimeout(y, 0))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new _event.Record(new k.Event(), 'One', 'bar', 42)))

      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'One', 'baz', 41)))
      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'One', 'ban', 42)))
      .then(() => log.publish(new _event.Record(new k.Event('food', 'not'), 'Two', 'baz', 42)))
      .then(() => log.publish(new _event.Record(new k.Event('food', 'one'), 'One', 'baz', 42)))

      .then(() => promise.should.eventually.equal('one later'))
  });

  it('does not un-subscribe Projection from EventLog until stream heads are reached', () => {
    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.unload()};

    let domain = Domain({log, strategy})
      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null));

    domain.respondTo(new k.Query('Foo').waitFor({Test: {bar: 42}}));
    domain.respondTo(new k.Query('Foo'));

    return new Promise(y => setTimeout(y, 0))
      .then(() => log.subscriptions.map(s => s.active).should.eql([true]))

      .then(() => log.publish(new _event.Record(new k.Event(), 'Test', 'bar', 42)))
      .then(() => new Promise(y => setTimeout(y, 0)))
      .then(() => log.subscriptions.map(s => s.active).should.eql([false]))
  });

  it('is not delayed if heads are already reached', () => {
    let log = new fake.EventLog();
    log.records = [new _event.Record(new k.Event('food'), 'Test', 'bar', 42)];

    return Domain({log})

      .add(new k.Projection('One')
        .applying('food', ()=>null)
        .respondingTo('Foo', ()=>'foo', ()=>'now'))

      .respondTo(new k.Query('Foo').waitFor({Test: {bar: 42}}))

      .should.eventually.equal('now')
  });
});