const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./../fakes');
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

  let Module = (deps = {}) =>
    new k.Module(
      deps.log || new k.EventLog(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy(),
      deps.store || new k.EventStore());

  it('fails if no executer is defined', () => {
    return Module()

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Cannot handle Command [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => Module()

      .add(new k.Aggregate('One')
        .executing('Foo')
        .executing('Foo')))

      .should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if Aggregate has no name', () => {
    (() => Module()

      .add(new k.Aggregate()))

      .should.throw(Error, 'Please provide a name.')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo'))

      .add(new k.Aggregate('Two')
        .executing('Foo', ()=>'foo'))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Too many handlers for Command [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>null))

      .execute(new k.Command('Foo')))

      .should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', payload => {
          executed.push(payload);
        }))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => executed.should.eql(['one']))
  });

  it('fails if the Command is rejected', () => {
    return Module()

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', function () {
          throw new Error('Nope')
        }))

      .execute(new k.Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('records Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>$, payload => [
          new k.Event('food', payload),
          new k.Event('bard', 'two')
        ]))

      .execute(new k.Command('Foo', 'one', 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [
          {name: 'food', payload: 'one', time: new Date()},
          {name: 'bard', payload: 'two', time: new Date()},
        ],
        streamId: 'one',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('does not record no Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>null))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([]));
  });

  it('records zero Events', () => {
    let store = new fake.EventStore();

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => []))

      .execute(new k.Command('Foo', null, 'trace'))

      .then(() => store.recorded.should.eql([{
        events: [],
        streamId: 'foo',
        onSequence: undefined,
        traceId: 'trace'
      }]));
  });

  it('fails if Events cannot be recorded', () => {
    let store = new fake.EventStore();
    store.record = () => {
      return Promise.reject(new Error('Nope'))
    };

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

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

    return Module({store})

      .add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', ()=>[]))

      .execute(new k.Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('applies only Events of Aggregate stream', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'not'), 'bar', 22)
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .initializing(function () {
          this.bards = [];
        })
        .applying('bard', function (payload) {
          this.bards.push(payload);
        })
        .executing('Foo', $=>$, function () {
          return [new k.Event('food', this.bards)]
        }))

      .execute(new k.Command('Foo', 'foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food', ['one'])],
        streamId: 'foo',
        onSequence: 21,
        traceId: undefined
      }]))

      .then(() => log.replayed.should.eql([{
        streamHeads: {}
      }]))
  });

  it('records Event with the last applied sequence', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('bard', 'one'), 'foo', 21),
      new k.Record(new k.Event('bard', 'two'), 'foo', 22),
      new k.Record(new k.Event('food', 'tre'), 'foo', 23),
      new k.Record(new k.Event('nope', 'not'), 'bar', 24),
    ];

    let store = new fake.EventStore();

    return Module({log, store})

      .add(new k.Aggregate('One')
        .executing('Foo', $=>'foo', function () {
          return [new k.Event('food')]
        }))

      .execute(new k.Command('Foo'))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('food')],
        streamId: 'foo',
        onSequence: 23,
        traceId: undefined
      }]))
  });
});