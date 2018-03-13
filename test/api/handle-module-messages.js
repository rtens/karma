const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('../common/fakes');

const k = require('../../src/karma');
const http = require('../../src/api/http');

describe('Handling Module Messages', () => {

  it('responds to a Query', () => {
    let persistence = {
      eventLog: () => new k.EventLog(),
      eventStore: () => new k.EventStore(),
      snapshotStore: () => new k.SnapshotStore()
    };

    let module = new k.Module('Test', new k.UnitStrategy(), persistence, persistence)

      .add(new k.Projection('foo')
        .respondingTo('Foo', ()=>'foo', ({foo})=>'Hello ' + foo));

    return new http.QueryHandler(module, req => new k.Query('Foo', {foo: 'Bar'}))

      .handle(new http.Request('ANY', '/'))

      .should.eventually.equal('Hello Bar')
  });

  it('executes a Command', () => {
    let store = new fake.EventStore();
    let persistence = {
      eventLog: () => new k.EventLog(),
      eventStore: () => store,
      snapshotStore: () => new k.SnapshotStore()
    };

    let module = new k.Module('Test', new k.UnitStrategy(), persistence, persistence)

      .add(new k.Aggregate('foo')
        .executing('Foo', ()=>'foo', ({foo}) => [new k.Event('food', foo)]));

    return new http.CommandHandler(module, req => new k.Command('Foo', {foo: 'Bar'}))

      .handle(new http.Request('ANY', '/').withTraceId('trace'))

      .should.eventually.eql(null)

      .then(() => store.recorded.map(r=>[r.events[0].payload, r.traceId]).should.eql([['Bar', 'trace']]))
  });

  it('responds with a Query after executing a Command', () => {
    let log = new fake.EventLog();
    log.records = [new k.Record(new k.Event(), 'foo', 40)];

    let persistence = {
      eventLog: () => log,
      eventStore: () => new k.EventStore(),
      snapshotStore: () => new k.SnapshotStore()
    };

    let applied;
    let module = new k.Module('Test', new k.UnitStrategy(), persistence, persistence)

      .add(new k.Aggregate('foo')
        .executing('Foo', ()=>'foo', () => [new k.Event(), new k.Event()]))

      .add(new k.Projection('bar')
        .applying('bard', payload => applied = payload)
        .respondingTo('Bar', ()=>'bar', ({bar}) => applied + bar));

    let response = new http.CommandHandler(module, req => new k.Command('Foo'))
      .respondingWith(req => new k.Query('Bar', {bar: req.path}))

      .handle(new http.Request('ANY', '/foo'));

    return new Promise(y => setTimeout(y, 0))

      .then(() => log.publish(new k.Record(new k.Event('bard', 'One'), 'foo', 42)))

      .then(() => response.should.eventually.eql('One/foo'))
  });
});