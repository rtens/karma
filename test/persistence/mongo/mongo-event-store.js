if (!process.env.MONGODB_URI_TEST)
  return console.log('Set $MONGODB_URI_TEST to test MongoEventStore');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

describe('MongoDB Event Store', () => {
  let store, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    store = new mongo.EventStore('Test', process.env.MONGODB_URI_TEST, db, 'bla_');

    onDb = execute => {
      let result = null;
      return mongodb.MongoClient.connect(process.env.MONGODB_URI_TEST)
        .then(client => Promise.resolve(execute(client.db(db)))
          .then(r => result = r)
          .catch(e => console.error(e))
          .then(() => client.close()))
        .then(() => result)
    }
  });

  afterEach(() => {
    return onDb(db => db.dropDatabase())
      .then(store.close())
  });

  it('fails if it cannot connect', () => {
    return new mongo.EventStore('Test', 'mongodb://foo', null, null, {reconnectTries: 0})
      
      .record([])

      .should.be.rejectedWith('EventStore cannot connect to MongoDB database')
  });

  it('creates indexed collection', () => {
    return store.connect()

      .then(() => onDb(db => db.collection('bla_event_store').indexes()))

      .then(indexes => {
        indexes[1].key.should.eql({a: 1, v: 1});
        indexes[1].unique.should.eql(true)
      })
  });

  it('stores Records in a Collection', () => {
    return store.record([
        new k.Event('food', {a: 'b'}, new Date('2011-12-13')),
        new k.Event('bard', {c: 421}, new Date('2013-12-11')),
      ], 'foo', null, 'trace')

      .then(records => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2011-12-13')), 'foo', 1, 'trace'),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2013-12-11')), 'foo', 2, 'trace')
      ]))

      .then(() => onDb(db => db.collection('bla_event_store').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          d: 'Test',
          a: 'foo',
          v: 1,
          e: [
            {n: 'food', a: {a: 'b'}, t: new Date('2011-12-13')},
            {n: 'bard', a: {c: 421}, t: new Date('2013-12-11')}
          ],
          c: 'trace'
        }]))
  });

  it('rejects Records on occupied heads', () => {
    return onDb(db => db.collection('bla_event_store').insertOne({
      a: 'foo',
      v: 42
    }))

      .then(() => store.record([], 'foo', 41))

      .should.be.rejectedWith('Out of sequence')
  });

  it('allows gaps in sequence', () => {
    return onDb(db => Promise.all([
      db.collection('bla_event_store').insertOne({a: 'foo', v: 21}),
      db.collection('bla_event_store').insertOne({a: 'bar', v: 42}),
    ]))

      .then(() => store.record([], 'foo', 46))

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