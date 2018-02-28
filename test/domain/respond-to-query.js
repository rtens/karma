const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../src/karma');

describe('Responding to a Query', () => {

  let Domain = (name, deps = {}) =>
    new k.Domain(name,
      deps.store || new k.EventStore(),
      deps.bus || new k.EventBus(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy());

  it('fails if no responder exists for that Query', () => {
    (() => Domain()

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot handle [Foo]')
  });

  it('fails if multiple responders exist for that Query in one Projection', () => {
    (() => Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo')
        .respondingTo('Foo')))

      .should.throw(Error, '[One] is already responding to [Foo]')
  });

  it('fails if multiple responders exist for that Query across Projections', () => {
    (() => Domain()

      .add(new k.Projection('One')
        .respondingTo('Foo'))

      .add(new k.Projection('Two')
        .respondingTo('Foo'))

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Too many handlers for [Foo]: [One, Two]')
  });

  it('fails if the Query cannot be mapped to a Projection instance', () => {
    (() => Domain()

      .add(new k.Projection()
        .respondingTo('Foo', ()=>null))

      .respondTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('returns a value', () => {
    return Domain()

      .add(new k.Projection()
        .respondingTo('Foo', ()=>'foo', query => 'foo' + query.payload))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('foobar')
  });

  it('may return a promise', () => {
    return Domain()

      .add(new k.Projection()
        .respondingTo('Foo', ()=>'foo', ()=>Promise.resolve('hi')))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.eventually.equal('hi')
  });

  it('fails if the Query is rejected', () => {
    return Domain()

      .add(new k.Projection()
        .respondingTo('Foo', ()=>'foo', () => {
          throw new Error('Nope')
        }))

      .respondTo(new k.Query('Foo', 'bar'))

      .should.be.rejectedWith('Nope')
  });

  it('handles multiple Queries concurrently', () => {
    let responses = [];

    let domain = Domain()

      .add(new k.Projection()
        .respondingTo('Foo', ()=>'foo', query => {
          return new Promise(y => setTimeout(() => y(query.payload), query.payload == 'one' ? 20 : 0))
        }));

    return new Promise(y => {
      setTimeout(() => domain.respondTo(new k.Query('Foo', 'one')).then(res => responses.push(res)).then(y), 0);
      setTimeout(() => domain.respondTo(new k.Query('Foo', 'two')).then(res => responses.push(res)), 10);
    })

      .then(() =>
        responses.should.eql(['two', 'one']))
  });
})
;