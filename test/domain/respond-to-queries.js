const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../src/karma');

describe('Responding to a Query', () => {

  let Module = (deps = {}) =>
    new k.Module(
      deps.log || new k.EventLog(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy(),
      deps.store || new k.EventStore());

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
});