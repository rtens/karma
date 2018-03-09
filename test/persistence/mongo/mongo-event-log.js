if (!process.env.MONGODB_URI_TEST || !process.env.MONGODB_OPLOG_URI_TEST)
  return console.log('Set $MONGODB_URI_TEST and $MONGODB_OPLOG_URI_TEST to test MongoEventLog');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

describe('MongoDB Event Log', () => {
  let log, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    log = new mongo.EventLog('Test', process.env.MONGODB_URI_TEST, process.env.MONGODB_OPLOG_URI_TEST, db, 'bla_');

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
      .then(() => log.close())
  });

  it('fails if it cannot connect to the database', () => {
    return new mongo.EventLog('Test', 'mongodb://foo', null, null, null, {reconnectTries: 0})

      .subscribe({})

      .should.be.rejectedWith('EventLog cannot connect to MongoDB database')
  });

  it('fails if it cannot connect to the oplog', () => {
    return (log = new mongo.EventLog('Test', process.env.MONGODB_URI_TEST, 'mongodb://foo', null, {reconnectTries: 0}))

      .subscribe({})

      .should.be.rejectedWith('EventLog cannot connect to MongoDB oplog')
  });

  it('replays stored Records of module', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({
        _id: mongodb.ObjectID.createFromTime(new Date('2013-12-11').getTime() / 1000),
        d: 'Test',
        a: 'foo',
        v: 21,
        e: [
          {n: 'food', a: {a: 'b'}, t: new Date('2011-12-13')},
          {n: 'bard', a: {c: 421}}
        ],
        c: 'trace'
      })))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({
        d: 'Not Test',
        e: [{n: 'food'}]
      })))

      .then(() => log.subscribe({}, record => records.push(record)))

      .then(() => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2011-12-13')), 'foo', 21, 'trace'),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2013-12-11')), 'foo', 22, 'trace')
      ]))
  });

  it('replays stored Records in sequence', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'foo', v: 22, e: [{n: 'three'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'bar', v: 21, e: [{n: 'one'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'foo', v: 21, e: [{n: 'two'}]})))

      .then(() => log.subscribe({}, record => records.push(record)))

      .then(() => records.map(r=>r.event.name).should.eql(['one', 'two', 'three']))
  });

  it('filters Records by sequence heads', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'foo', v: 22, e: [{n: 'one'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'bar', v: 22, e: [{n: 'not'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'foo', v: 21, e: [{n: 'not'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'bar', v: 25, e: [{n: 'two'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', a: 'baz', v: 42, e: [{n: 'tre'}]})))

      .then(() => log.subscribe({foo: 21, bar: 23}, record => records.push(record)))

      .then(() => records.map(r=>r.event.name).should.eql(['one', 'two', 'tre']))
  });

  it('notifies about new Records', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe({}, record => records.push(record)))

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({
        _id: mongodb.ObjectID.createFromTime(new Date('2013-12-11').getTime() / 1000),
        d: 'Test',
        a: 'foo',
        v: 23,
        e: [
          {n: 'food', a: {a: 'b'}, t: new Date('2011-12-13')},
          {n: 'bard', a: {c: 421}}
        ],
        c: 'trace'
      })))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({
        d: 'Not Test',
        e: [{n: 'food'}]
      })))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2011-12-13')), 'foo', 23, 'trace'),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2013-12-11')), 'foo', 24, 'trace')
      ]))
  });

  it('stops notifying when cancelled', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe({}, record => records.push(record)))

      .then(subscription => subscription.cancel())

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', e: [{n: 'food'}]})))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => records.should.eql([]))
  });

  it('combines replay and notification', () => {
    let records = [];

    return Promise.resolve()

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', v: 1, e: [{n: 'one'}]})))
      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', v: 2, e: [{n: 'two'}]})))

      .then(() => log.subscribe({}, record => records.push(record)))

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', e: [{n: 'tre'}]})))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => records.map(r=>r.event.name).should.eql(['one', 'two', 'tre']))
  });
});