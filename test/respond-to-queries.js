const chai = require('chai');
const promised = require('chai-as-promised');
const should = chai.should();
chai.use(promised);

const fake = require('./common/fakes');
const k = require('../src/karma');

describe('Responding to a Query', () => {
  let Module;

  beforeEach(() => {
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
    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>null))

      .respondTo(new k.Query('Foo'))

      .should.be.rejectedWith('Cannot map [Foo]')
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

  it('can be delayed until Projection reaches stream heads', () => {
    let response = null;

    let log = new fake.EventLog();

    let applied;
    let module = Module({log})
      .add(new k.Projection('One')
        .applying('food', payload => applied = payload)
        .respondingTo('Foo', ()=>'foo', () => applied + ' later'));

    let promise = module.respondTo(new k.Query('Foo').waitFor({bar: 42, baz: 42}))
      .then(r => response = r);

    return new Promise(y => setTimeout(y, 0))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event(), 'bar', 41)))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event('food', 'one'), 'baz', 42)))
      .then(() => should.not.exist(response))

      .then(() => log.publish(new k.Record(new k.Event(), 'bar', 42)))
      .then(() => promise.should.eventually.equal('one later'))
  });

  it('does not un-subscribe Projection from EventLog until stream heads are reached', () => {
    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.unload()};

    let module = Module({log, strategy})
      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null));

    module.respondTo(new k.Query('Foo').waitFor({bar: 42}));
    module.respondTo(new k.Query('Foo'));

    return new Promise(y => setTimeout(y, 0))
      .then(() => log.subscriptions.map(s => s.active).should.eql([true]))

      .then(() => log.publish(new k.Record(new k.Event(), 'bar', 42)))
      .then(() => log.subscriptions.map(s => s.active).should.eql([false]))
  });

  it('is not delayed if heads are already reached', () => {
    let log = new fake.EventLog();
    log.records = [new k.Record(new k.Event('food'), 'bar', 42)];

    return Module({log})

      .add(new k.Projection('One')
        .applying('food', ()=>null)
        .respondingTo('Foo', ()=>'foo', ()=>'now'))

      .respondTo(new k.Query('Foo').waitFor({bar: 42}))

      .should.eventually.equal('now')
  });
});