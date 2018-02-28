const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

describe('Executing a Command', () => {

  let _Date = Date;

  before(() => {
    Date = function () {
      return new _Date('2011-12-13T14:15:16Z');
    };
    Date.prototype = _Date.prototype;
  });

  after(() => {
    Date = _Date;
  });

  let Domain = (name, deps = {}) =>
    new k.Domain(name,
      deps.store || new k.EventStore(),
      deps.bus || new k.EventBus(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy());

  it('fails if no executer is defined', () => {
    (() => Domain()

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot handle [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate('One')
        .executing('Foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo'))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Too many handlers for [Foo]: [One, Two]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, command => {
          executed.push(command);
        }))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql([{name: 'Foo', payload: 'one', traceId: 'trace'}]))
  });

  it('fails if the Command is rejected', () => {
    return Domain()

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', command => [
          new k.Event('food', command.payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        aggregateId: 'id',
        onRevision: null,
        traceId: 'trace'
      }]));
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'id', () => []))

      .execute(new k.Command('Foo', null, 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [],
        aggregateId: 'id',
        onRevision: null,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let store = new fake.EventStore();
    store.record = () => {
      return Promise.reject(new Error('Nope'))
    };

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries recording before giving up', () => {
    let store = new fake.EventStore();
    let count = 0;
    store.record = () => new Promise(y => {
      if (count++ < 3) throw new Error(count);
      y()
    });

    return Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>1, ()=>[]))

      .execute(new k.Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('queues Commands per Aggregate', () => {
    var store = new (class extends fake.EventStore {
      record(events, aggregateId, onRevision, traceId) {
        return new Promise(y =>
          setTimeout(() => y(super.record(events, aggregateId, onRevision, traceId)),
            events[0].name == 'Foo' ? 30 : 0))
      }
    });

    var domain = Domain('Test', {store})

      .add(new k.Aggregate()
        .executing('Foo', ()=>'one', () => [new k.Event('Foo')])
        .executing('Bar', ()=>'one', () => [new k.Event('Bar')])
        .executing('Baz', ()=>'two', () => [new k.Event('Baz')]));

    return new Promise(y => {
      setTimeout(() => domain.execute(new k.Command('Foo')), 0);
      setTimeout(() => domain.execute(new k.Command('Bar')).then(y), 10);
      setTimeout(() => domain.execute(new k.Command('Baz')), 15);
    })

      .then(() =>
        store.recorded.map(p=>p.events[0].name).should.eql(['Baz', 'Foo', 'Bar']))
  });
});