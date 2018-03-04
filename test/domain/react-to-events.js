const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./../fakes');
const k = require('../../src/karma');

describe('Reacting to an Event', () => {

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

  it('fails if a Saga has more than one reactor for the same Event', () => {
    (() => Module()

      .add(new k.Saga('One')
        .reactingTo('food')
        .reactingTo('food')))

      .should.throw('Reaction to [food] is already defined in [One]')
  });

  it('does not invoke the reactor for existing Events', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('food', 'two')),
    ];

    let reactions = [];

    Module({log})

      .add(new k.Saga('one')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)));

    reactions.should.eql([])
  });

  it('invokes the reactor for published Events', () => {
    let log = new fake.EventLog();
    let reactions = [];

    Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload))
        .reactingTo('bard', ()=>'foo', (payload) => reactions.push(payload)));

    return log.publish(new k.Record(new k.Event('food', 'one')))

      .then(() => reactions.should.eql(['one']))
  });

  it('invokes reactors of multiple Sagas', () => {
    let log = new fake.EventLog();
    let reactions = [];

    Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('a ' + payload)))

      .add(new k.Saga('Two')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push('b ' + payload)));

    return log.publish(new k.Record(new k.Event('food', 'one')))

      .then(() => reactions.should.eql(['a one', 'b one']))
  });

  it('does not invoke reactor if reaction is locked', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('_saga-reaction-locked', {streamId: 'foo', sequence: 22}), 'Saga-One-bar', 3)
    ];

    let store = new fake.EventStore();

    let reactions = [];
    Module({log, store})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)));

    return log.publish(new k.Record(new k.Event('food', 'one'), 'foo', 21))

      .then(() => log.publish(new k.Record(new k.Event('food', 'not'), 'foo', 22)))

      .then(() => log.publish(new k.Record(new k.Event('food', 'two'), 'bar', 22)))

      .then(() => reactions.should.eql(['one', 'two']))

      .then(() => store.recorded.should.eql([{
        events: [new k.Event('_saga-reaction-locked', {sagaKey: 'Saga-One-bar', streamId: 'foo', sequence: 21})],
        streamId: 'Saga-One-bar',
        onSequence: 3,
        traceId: undefined
      }, {
        events: [new k.Event('_saga-reaction-locked', {sagaKey: 'Saga-One-bar', streamId: 'bar', sequence: 22})],
        streamId: 'Saga-One-bar',
        onSequence: 3,
        traceId: undefined
      }]))
  });

  it('invokes reactor if reaction is unlocked', () => {
    let log = new fake.EventLog();
    log.records = [
      new k.Record(new k.Event('_saga-reaction-locked', {streamId: 'foo', sequence: 22}), 'Saga-One-bar', 3),
      new k.Record(new k.Event('_saga-reaction-unlocked', {streamId: 'foo', sequence: 22}), 'Saga-One-bar', 4)
    ];

    let store = new fake.EventStore();

    let reactions = [];
    Module({log, store})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'bar', (payload) => reactions.push(payload)));

    return log.publish(new k.Record(new k.Event('food', 'one'), 'foo', 22))

      .then(() => reactions.should.eql(['one']))
  });

  it('retries before giving up when failing', () => {
    let waits = [];
    let _setTimeout = setTimeout;
    setTimeout = (callback, wait) => {
      waits.push(wait);
      return callback();
    };

    let log = new fake.EventLog();

    let store = new fake.EventStore();

    let reactions = [];
    Module({log, store})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => {
          reactions.push(payload);

          let error = new Error();
          error.stack = 'Stack ' + reactions.length;
          throw error;
        }));

    return log.publish(new k.Record(new k.Event('food', 'one'), 'bar', 23, 'trace'))

      .then(() => setTimeout = _setTimeout)

      .then(() => waits.should.eql([1, 10, 100, 1000]))

      .then(() => reactions.should.eql(['one', 'one', 'one', 'one', 'one']))

      .then(() => store.recorded.map(r=>r.events.map(e=>[e.name, e.payload])).should.eql([
        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-failed", {
          sagaId: 'foo',
          sagaKey: 'Saga-One-foo',
          record: {
            event: {name: 'food', payload: 'one', time: new Date()},
            sequence: 23,
            streamId: 'bar',
            traceId: 'trace'
          },
          errors: ['Stack 1', 'Stack 2', 'Stack 3', 'Stack 4', 'Stack 5']
        }]]
      ]))
  });

  it('retries when failing by promise rejection', () => {
    let waits = [];
    let _setTimeout = setTimeout;
    setTimeout = (callback, wait) => {
      waits.push(wait);
      return callback();
    };

    let log = new fake.EventLog();

    let reactions = [];
    Module({log})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => {
          reactions.push(payload);
          return Promise.reject(new Error('Nope'))
        }));

    return log.publish(new k.Record(new k.Event('food', 'one'), 'bar', 23))

      .then(() => setTimeout = _setTimeout)

      .then(() => reactions.should.eql(['one', 'one', 'one', 'one', 'one']))
  });

  it('retries on demand', () => {
    let log = new fake.EventLog();

    let store = new fake.EventStore();

    let reactions = [];
    Module({log, store})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => reactions.push(payload)));

    return log.publish(new k.Record(new k.Event('_saga-reaction-retry-requested', {
      sagaId: 'foo',
      sagaKey: 'Saga-One-foo',
      record: {
        event: {name: 'food', payload: 'one', time: new Date()},
        sequence: 23,
        streamId: 'bar',
        traceId: 'trace'
      }
    })))

      .then(() => reactions.should.eql(['one']))

      .then(() => store.recorded.map(r=>r.events.map(e=>[e.name, e.payload])).should.eql([
        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]]
      ]))
  });

  it('retries on demand only once', () => {
    let log = new fake.EventLog();

    let store = new fake.EventStore();

    let reactions = [];
    Module({log, store})

      .add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', (payload) => {
          reactions.push(payload);

          let error = new Error();
          error.stack = 'Stack ' + reactions.length;
          throw error;
        }));

    return log.publish(new k.Record(new k.Event('_saga-reaction-retry-requested', {
      sagaId: 'foo',
      sagaKey: 'Saga-One-foo',
      record: {
        event: {name: 'food', payload: 'one', time: new Date()},
        sequence: 23,
        streamId: 'bar',
        traceId: 'trace'
      }
    })))

      .then(() => reactions.should.eql(['one']))

      .then(() => store.recorded.map(r=>r.events.map(e=>[e.name, e.payload])).should.eql([
        [["_saga-reaction-locked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],
        [["_saga-reaction-unlocked", {sagaKey: 'Saga-One-foo', sequence: 23, streamId: 'bar'}]],

        [["_saga-reaction-failed", {
          sagaId: 'foo',
          sagaKey: 'Saga-One-foo',
          record: {
            event: {name: 'food', payload: 'one', time: new Date()},
            sequence: 23,
            streamId: 'bar',
            traceId: 'trace'
          },
          errors: ['Stack 1']
        }]]
      ]))
  });
});