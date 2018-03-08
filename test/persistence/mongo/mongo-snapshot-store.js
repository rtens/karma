if (!process.env.MONGODB_URI_TEST)
  return console.log('Set $MONGODB_URI_TEST to test MongoSnapshotStore');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

describe('MongoDB Snapshot Store', () => {
  let snapshots, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    snapshots = new mongo.SnapshotStore('Test', process.env.MONGODB_URI_TEST, db);

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
      .then(() => snapshots.close())
  });

  it('fails if it cannot connect', () => {
    return new mongo.SnapshotStore('Test', 'mongodb://foo')

      .connect({reconnectTries: 0})

      .should.be.rejectedWith('SnapshotStore cannot connect to MongoDB database')
  });

  it('creates indexed collection', () => {
    return snapshots.connect()

      .then(() => onDb(db => db.collection('snapshots_Test').indexes()))

      .then(indexes => {
        indexes[1].key.should.eql({k: 1, v: 1});
        should.not.equal(indexes[1].unique, null)
      })
  });

  it('stores Snapshots in a collection', () => {
    return snapshots.connect()

      .then(() => snapshots.store('foo', 'v1', new k.Snapshot({foo: 42}, {foo: 'bar'})))

      .then(() => onDb(db => db.collection('snapshots_Test').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          k: 'foo',
          v: 'v1',
          h: {foo: 42},
          s: {foo: 'bar'}
        }]))
  });

  it('fetches Snapshots from a collection', () => {
    return snapshots.connect()

      .then(() => onDb(db => db.collection('snapshots_Test').insertOne({
        k: 'foo',
        v: 'v1',
        h: {foo: 42},
        s: {foo: 'bar'}
      })))

      .then(() => snapshots.fetch('foo', 'v1'))

      .then(snapshot => snapshot.should.eql(new k.Snapshot({foo: 42}, {foo: 'bar'})))
  });

  it('fails if the Snapshot does not exist', () => {
    return snapshots.connect()

      .then(() => onDb(db => db.collection('snapshots_Test').insertOne({
        k: 'foo',
        v: 'v1',
        h: {foo: 42},
        s: {foo: 'bar'}
      })))

      .then(() => snapshots.fetch('foo', 'v2'))

      .should.be.rejectedWith('No snapshot')
  });
});