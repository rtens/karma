const chai = require('chai');
const promised = require('chai-as-promised');
const should = chai.should();
chai.use(promised);

const fake = require('./common/fakes');
const k = require('../src/karma');

describe('Responding to a Query', () => {
  let Module;

  before(() => {
    Module = (args = {}) =>
      new k.Module(
        args.name || 'Test',
        args.strategy || new k.RepositoryStrategy(),
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

  it('fails if no responder exists for that Query', () => {
    return Module()

      .respondTo(new k.Query('Foo'))

      .should.be.rejectedWith(Error, 'Cannot handle Query [Foo]')
  });

  it('fails if multiple responders exist for that Query in one Projection', () => {
    (() => Module()

      .add(new k.Projection('One')
        .respondingTo('Foo')
        .respondingTo('Foo')))

      .should.throw(Error, '[One] is already responding to [Foo]')
  });

  it('fails if multiple responders exist for that Query across Projections', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo'))

      .add(new k.Projection('Two')
        .respondingTo('Foo', ()=>'foo'))

      .respondTo(new k.Query('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Query [Foo]')
  });

  it('fails if the Query cannot be mapped to a Projection instance', () => {
    (() => Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>null))

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('returns a value', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', payload => 'foo' + payload))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('foobar')
  });

  it('may return a promise', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', (payload)=>Promise.resolve(payload)))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('bar')
  });

  it('fails if the Query is rejected', () => {
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', () => {
          throw new Error('Nope')
        }))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.be.rejectedWith('Nope')
  });

  it('can be delayed until a Record is applied', () => {
    let response = null;

    let log = new fake.EventLog();

    let module = Module({log})
      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>'later'));

    let promise = module.respondTo(new k.Query('Foo').waitFor({bar: 42, baz: 42}))
      .then(r => response = r);

    return new Promise(y => setTimeout(y, 0))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event(), 'bar', 41)))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event(), 'baz', 42)))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event(), 'bar', 42)))
      .then(() => promise.should.eventually.equal('later'))
  });

  it('is not delayed if the Record is already applied', () => {
    let log = new fake.EventLog();
    log.records = [new k.Record(new k.Event(), 'bar', 42)];

    return Module({log})

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>'now'))

      .respondTo(new k.Query('Foo').waitFor({bar: 42}))

      .should.eventually.equal('now')
  });
});