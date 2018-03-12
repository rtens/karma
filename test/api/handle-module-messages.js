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

    let module = new k.Module('Test', new k.RepositoryStrategy(), persistence, persistence)

      .add(new k.Projection('foo')
        .respondingTo('Foo', ()=>'foo', ({foo})=>'Hello ' + foo));

    return new http.QueryHandler(module, req => new k.Query('Foo', {foo: 'Bar'}))

      .handle(new http.Request('ANY', '/'))

      .should.eventually.equal('Hello Bar')
  });

  it('executes a Command', () => {
    let persistence = {
      eventLog: () => new k.EventLog(),
      eventStore: () => new k.EventStore(),
      snapshotStore: () => new k.SnapshotStore()
    };

    let executed = [];
    let module = new k.Module('Test', new k.RepositoryStrategy(), persistence, persistence)

      .add(new k.Aggregate('foo')
        .executing('Foo', ()=>'foo', ({foo}) => executed.push(foo)));

    return new http.CommandHandler(module, req => new k.Command('Foo', {foo: 'Bar'}))

      .handle(new http.Request('ANY', '/'))

      .should.eventually.eql(null)

      .then(() => executed.should.eql(['Bar']))
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
    let module = new k.Module('Test', new k.RepositoryStrategy(), persistence, persistence)

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