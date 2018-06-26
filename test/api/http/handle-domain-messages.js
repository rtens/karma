const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../../../src/event');

const fake = require('../../../src/specification/fakes');
const k = require('../../..');

describe('Handling Domain Messages via HTTP', () => {

  it('responds to a Query', () => {
    let persistence = {
      eventLog: () => new fake.EventLog(),
      eventStore: () => new fake.EventStore(),
      snapshotStore: () => new fake.SnapshotStore()
    };

    let domain = new k.Domain('Test', persistence, persistence)

      .add(new k.Projection('foo')
        .respondingTo('Foo', ()=>'foo', ({foo}, query)=>'Hello ' + foo + query.traceId));

    return new k.api.http.RequestHandler()
      .handling(new k.api.http.QueryHandler(domain, () => new k.Query('Foo', {foo: 'Bar'})))

      .handle(new k.api.http.Request('ANY', '/').withTraceId('_trace'))

      .should.eventually.eql(new k.api.http.Response('Hello Bar_trace'))
  });

  it('executes a Command', () => {
    let store = new fake.EventStore();
    let persistence = {
      eventLog: () => new fake.EventLog(),
      eventStore: () => store,
      snapshotStore: () => new fake.SnapshotStore()
    };

    let domain = new k.Domain('Test', persistence, persistence)

      .add(new k.Aggregate('foo')
        .executing('Foo', ()=>'foo', ({foo}) => [new k.Event('food', foo)]));

    return new k.api.http.RequestHandler()
      .handling(new k.api.http.CommandHandler(domain, () => new k.Command('Foo', {foo: 'Bar'})))

      .handle(new k.api.http.Request('ANY', '/').withTraceId('trace'))

      .should.eventually.eql(new k.api.http.Response())

      .then(() => store.recorded.map(r=>[r.events[0].payload, r.traceId]).should.eql([['Bar', 'trace']]))
  });

  it('responds with a Query after executing a Command', () => {
    let log = new fake.EventLog();
    log.records = [new _event.Record(new k.Event(), 'foo', 40)];

    let persistence = {
      eventLog: () => log,
      eventStore: () => new fake.EventStore(),
      snapshotStore: () => new fake.SnapshotStore()
    };

    let applied;
    let domain = new k.Domain('Test', persistence, persistence)

      .add(new k.Aggregate('foo')
        .executing('Foo', ()=>'foo', () => [new k.Event(), new k.Event()]))

      .add(new k.Projection('bar')
        .applying('bard', payload => applied = payload)
        .respondingTo('Bar', ()=>'bar', ({bar}) => applied + bar));

    let response = new k.api.http.CommandHandler(domain, () => new k.Command('Foo'))
      .respondingWith(req => new k.Query('Bar', {bar: req.path}))

      .handle(new k.api.http.Request('ANY', '/foo'));

    return new Promise(y => setTimeout(y, 0))

      .then(() => log.publish(new _event.Record(new k.Event('bard', 'One'), 'foo', 42)))

      .then(() => response.should.eventually.eql('One/foo'))
  });
});