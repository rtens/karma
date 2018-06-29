if (!process.env.TEST_MONGODB_URI)
  return console.log('Set $TEST_MONGODB_URI to test MongoEventStore');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../../../src/event');
const _mongo = require('../../../src/persistence/mongo');

const mongodb = require('mongodb');

describe('MongoDB Event Store', () => {
  let _Date, store, onDb;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2001-02-03T12:00:00Z');
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;

    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    store = new _mongo.EventStore(process.env.TEST_MONGODB_URI, db, 'bla_');

    onDb = execute => {
      let result = null;
      return mongodb.MongoClient.connect(process.env.TEST_MONGODB_URI)
        .then(client => Promise.resolve(execute(client.db(db)))
          .then(r => result = r)
          .catch(e => console.error(e))
          .then(() => client.close()))
        .then(() => result)
    }
  });

  afterEach(() => {
    Date = _Date;
    return onDb(db => db.dropDatabase())
      .then(store.close())
  });

  it('fails if it cannot connect', () => {
    return new _mongo.EventStore('Test', 'mongodb://foo', null, null, {reconnectTries: 0})

      .record([])

      .should.be.rejectedWith('EventStore cannot connect to MongoDB database')
  });

  it('creates indexed collection', () => {
    return store.connect()

      .then(() => onDb(db => db.collection('bla_event_store').indexes()))

      .then(indexes => indexes.map(i=>({key: i.key, unique: !!i.unique})).should.contain.deep(
        {key: {d: 1, a: 1, v: 1}, unique: true}))
  });

  it('stores Records in a Collection', () => {
    return store.record([
      new _event.Event('food', {a: 'b'}, new Date('2001-02-03T12:00:00.500Z')),
      new _event.Event('bard', {c: 421}, new Date('2013-12-11')),
    ], 'Test', 'foo', null, 'trace')

      .then(records => records.should.eql([
        new _event.Record(new _event.Event('food', {a: 'b'}, new Date('2001-02-03T12:00:00.500Z')),
          'Test', 'foo', 1, 'trace'),
        new _event.Record(new _event.Event('bard', {c: 421}, new Date('2013-12-11')),
          'Test', 'foo', 2, 'trace')
      ]))

      .then(() => onDb(db => db.collection('bla_event_store').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.getTimestamp()})).should
        .eql([{
          _id: new Date(),
          d: 'Test',
          a: 'foo',
          v: 1,
          e: [
            {n: 'food', a: {a: 'b'}, t: null},
            {n: 'bard', a: {c: 421}, t: new Date('2013-12-11')}
          ],
          c: 'trace'
        }]))
  });

  it('rejects Records on occupied heads', () => {
    return onDb(db => db.collection('bla_event_store').insertOne({
      d: 'Test',
      a: 'foo',
      v: 42
    }))

      .then(() => store.record([], 'Test', 'foo', 41))

      .should.be.rejectedWith('Out of sequence')
  });

  it('allows gaps and fractions in sequence', () => {
    return onDb(db => Promise.all([
      db.collection('bla_event_store').insertOne({a: 'foo', v: 21}),
      db.collection('bla_event_store').insertOne({a: 'bar', v: 42}),
    ]))

      .then(() => store.record([], 'Test', 'foo', 46.7))

      .then(() => onDb(db => db.collection('bla_event_store').find().toArray()))

      .then(docs => docs.slice(-1)
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          d: 'Test',
          a: 'foo',
          v: 47,
          e: [],
          c: null
        }]))
  });
});