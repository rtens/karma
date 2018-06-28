if (!process.env.TEST_MONGODB_URI)
  return console.log('Set $TEST_MONGODB_URI to test MongoSnapshotStore');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _persistence = require('../../../src/persistence');
const _mongo = require('../../../src/persistence/mongo');

const mongodb = require('mongodb');

describe.skip('MongoDB Snapshot Store', () => {
  let snapshots, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    snapshots = new _mongo.SnapshotStore('Test', process.env.TEST_MONGODB_URI, db, 'bla_');

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
    return onDb(db => db.dropDatabase())
      .then(() => snapshots.close())
  });

  it('fails if it cannot connect', () => {
    return new _mongo.SnapshotStore('Test', 'mongodb://foo', null, null, {reconnectTries: 0})

      .fetch()

      .should.be.rejectedWith('SnapshotStore cannot connect to MongoDB database')
  });

  it('creates indexed collection', () => {
    return snapshots.connect()

      .then(() => onDb(db => db.collection('bla_snapshots_Test').indexes()))

      .then(indexes => {
        indexes[1].key.should.eql({k: 1, v: 1});
        should.not.equal(indexes[1].unique, null)
      })
  });

  it('stores Snapshots in a collection', () => {
    return snapshots.store('foo', 'v1',
      new _persistence.Snapshot(new Date('2011-12-13T14:15:16Z'), {foo: 42}, {foo: 'bar'}))

      .then(() => onDb(db => db.collection('bla_snapshots_Test').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          k: 'foo',
          v: 'v1',
          t: new Date('2011-12-13T14:15:16Z'),
          h: {foo: 42},
          s: {foo: 'bar'}
        }]))
  });

  it('fetches Snapshots from a collection', () => {
    return onDb(db => db.collection('bla_snapshots_Test').insertOne({
      k: 'foo',
      v: 'v1',
      t: new Date('2011-12-13T14:15:16Z'),
      h: {foo: 42},
      s: {foo: 'bar'}
    }))

      .then(() => snapshots.fetch('foo', 'v1'))

      .then(snapshot => snapshot.should.eql(
        new _persistence.Snapshot(new Date('2011-12-13T14:15:16Z'), {foo: 42}, {foo: 'bar'})))
  });

  it('updates existing Snapshots in a collection', () => {
    return snapshots.store('foo', 'v1',
      new _persistence.Snapshot(new Date('2011-12-13'), {foo: 21}, {foo: 'bar'}))

      .then(() => snapshots.store('foo', 'v1',
        new _persistence.Snapshot(new Date('2011-12-14'), {foo: 42}, {foo: 'baz', bar: 'bam'})))

      .then(() => onDb(db => db.collection('bla_snapshots_Test').find().toArray()))

      .then(docs => docs
        .map(d=>({...d, _id: d._id.constructor.name})).should
        .eql([{
          _id: 'ObjectID',
          k: 'foo',
          v: 'v1',
          t: new Date('2011-12-14'),
          h: {foo: 42},
          s: {foo: 'baz', bar: 'bam'}
        }]))
  });

  it('fails if the Snapshot does not exist', () => {
    return onDb(db => db.collection('bla_snapshots_Test').insertOne({
      k: 'foo',
      v: 'v1'
    }))

      .then(() => snapshots.fetch('foo', 'v2'))

      .should.be.rejectedWith('No snapshot')
  });
});