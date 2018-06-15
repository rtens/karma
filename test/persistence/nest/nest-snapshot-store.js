const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _persistence = require('../../../src/persistence');
const _nest = require('../../../src/persistence/nest');
const Datastore = require('nestdb');

if (!process.env.TEST_DATA_DIR)
  console.log('Set $TEST_DATA_DIR to test persistent NestDB Snapshot Store');

describe('NestDB Snapshot Store', () => {
  let db, snapshots;

  beforeEach(() => {
    if (process.env.TEST_DATA_DIR) {
      db = new Datastore({filename: process.env.TEST_DATA_DIR + '/Test'})
    } else {
      db = new Datastore();
    }

    snapshots = new _nest.SnapshotStore('Test', db);
    return new Promise((y, n) => db.load(err => err ? n(err) : y()))
  });

  afterEach(() => {
    db.destroy();
  });

  it('stores Snapshots', () => {
    let snapshot = new _persistence.Snapshot(new Date('2011-12-13'), {foo: 42}, {foo: 'bar'});

    return snapshots.store('foo', 'v1', snapshot)

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs.should.eql([{
        _id: JSON.stringify({key: 'foo', ver: 'v1'}),
        las: new Date('2011-12-13'),
        had: {foo: 42},
        sta: {foo: 'bar'}
      }]))
  });

  it('fetches Snapshots', () => {
    return Promise.resolve()

      .then(() => new Promise(y => db.insert([
        {
          _id: JSON.stringify({key: 'foo', ver: 'v1'})
        }, {
          _id: JSON.stringify({key: 'bar', ver: 'v2'})
        }, {
          _id: JSON.stringify({key: 'foo', ver: 'v2'}),
          las: new Date('2011-12-13'),
          had: {foo: 42},
          sta: {foo: 'bar'}
        }
      ], y)))

      .then(() => snapshots.fetch('foo', 'v2'))

      .then(snapshot => snapshot.should.eql(
        new _persistence.Snapshot(new Date('2011-12-13'), {foo: 42}, {foo: 'bar'})))
  });

  it('updates existing Snapshots', () => {
    let snapshot1 = new _persistence.Snapshot(new Date('2011-12-13'), {foo: 21}, {foo: 'bar'});
    let snapshot2 = new _persistence.Snapshot(new Date('2011-12-14'), {foo: 42}, {foo: 'baz'});

    return snapshots.store('foo', 'v1', snapshot1)

      .then(() => snapshots.store('bar', 'v1', snapshot1))

      .then(() => snapshots.store('foo', 'v1', snapshot2))

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs.should.eql([{
        _id: JSON.stringify({key: 'bar', ver: 'v1'}),
        las: new Date('2011-12-13'),
        had: {foo: 21},
        sta: {foo: 'bar'}
      }, {
        _id: JSON.stringify({key: 'foo', ver: 'v1'}),
        las: new Date('2011-12-14'),
        had: {foo: 42},
        sta: {foo: 'baz'}
      }]))
  });

  it('fails if the Snapshot does not exist', () => {
    return Promise.resolve()

      .then(() => new Promise(y => db.insert([
        {_id: JSON.stringify({key: 'foo', ver: 'v1'})}
      ], y)))

      .then(() => snapshots.fetch('foo', 'v2'))

      .should.be.rejectedWith('No snapshot');
  });
});