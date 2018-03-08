if (!process.env.MONGO_TEST_URL)
  return console.log('Set $MONGO_TEST_URL to test MongoEventStore');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

describe('MongoDB Event Store', () => {
  let db, store, onDb;

  beforeEach(() => {
    db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    store = new mongo.EventStore('Test', process.env.MONGO_TEST_URL, db);

    onDb = execute => {
      let result = null;
      return mongodb.MongoClient.connect(process.env.MONGO_TEST_URL)
        .then(client => Promise.resolve(execute(client.db(db)))
          .then(r => result = r)
          .catch(e => client.close() && console.error(e))
          .then(() => client.close()))
        .then(() => result)
    }
  });

  afterEach(() => {
    return onDb(db => db.dropDatabase())
  });

  it('fails if it cannot connect', () => {
    return new mongo.EventStore('Test', 'mongodb://foo')

      .connect({reconnectTries: 0})

      .should.be.rejectedWith('Cannot connect to MongoDB')
  });

  it('creates indexed collection', () => {
    return store.connect()

      .then(() => store.close())

      .then(() => onDb(db => db.collection('event_store').indexes()))

      .then(indexes => {
        indexes[1].key.should.eql({a: 1, v: 1});
        indexes[1].unique.should.eql(true)
      })
  });

  it('stores Records in a Collection', () => {
    let records;

    return store.connect()

      .then(() => store.record([
        new k.Event('food', {a: 'b'}, new Date('2011-12-13')),
        new k.Event('bard', {c: 421}, new Date('2013-12-11')),
      ], 'foo', null, 'trace'))

      .then(r => records = r)

      .then(() => store.close())

      .then(() => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2011-12-13')), 'foo', 0, 'trace'),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2013-12-11')), 'foo', 1, 'trace')
      ]))

      .then(() => onDb(db => db.collection('event_store').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          d: 'Test',
          a: 'foo',
          v: null,
          e: [
            {n: 'food', a: {a: 'b'}, t: new Date('2011-12-13')},
            {n: 'bard', a: {c: 421}, t: new Date('2013-12-11')}
          ],
          c: 'trace'
        }]))
  });

  it('rejects Records on occupied heads', () => {
    return onDb(db => db.collection('event_store').insertOne({
      a: 'foo',
      v: 42
    }))

      .then(() => store.connect())

      .then(() => store.record([], 'foo', 42))

      .should.be.rejectedWith('Out of sequence')

      .then(() => store.close())
  });

  it('allows gaps in sequence', () => {
    return onDb(db => Promise.all([
      db.collection('event_store').insertOne({a: 'foo', v: 21}),
      db.collection('event_store').insertOne({a: 'bar', v: 42}),
    ]))

      .then(() => store.connect())

      .then(() => store.record([], 'foo', 42))

      .then(() => store.close())

      .then(() => onDb(db => db.collection('event_store').find().toArray()))

      .then(docs => docs.slice(-1)
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          d: 'Test',
          a: 'foo',
          v: 42,
          e: [],
          c: null
        }]))
  });
});