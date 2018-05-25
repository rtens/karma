if (!process.env.MONGODB_URI_TEST || !process.env.MONGODB_OPLOG_URI_TEST)
  return console.log('Set $MONGODB_URI_TEST and $MONGODB_OPLOG_URI_TEST to test MongoEventLog');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

const objectId = time => mongodb.ObjectID.createFromTime(new Date(time).getTime() / 1000);

describe('MongoDB Event Log', () => {
  let log, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 10000);
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

      .subscribe()

      .should.be.rejectedWith('EventLog cannot connect to MongoDB database')
  });

  it('fails if it cannot connect to the oplog', () => {
    return (log = new mongo.EventLog('Test', process.env.MONGODB_URI_TEST, 'mongodb://foo', null, {reconnectTries: 0}))

      .subscribe()

      .should.be.rejectedWith('EventLog cannot connect to MongoDB oplog')
  });

  it('creates indices', () => {
    return log.connect()

      .then(() => onDb(db => db.collection('bla_event_store').indexes()))

      .then(indexes => {
        indexes.map(i=>i.key).should.contain.deep({d: 1, a: 1, _id: 1});
        indexes.map(i=>i.key).should.contain.deep({d: 1, 'e.n': 1, _id: 1});
      })
  });

  it('replays stored Records of module', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([{
        _id: objectId('2017-12-11'),
        d: 'Test',
        a: 'foo',
        v: 21,
        e: [
          {n: 'food', a: {a: 'b'}, t: new Date('2017-12-13')},
          {n: 'bard', a: {c: 421}}
        ],
        c: 'trace'
      }, {
        d: 'Not Test',
        e: [{n: 'food'},],
      }])))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2017-12-13')),
          'foo', 21, 'trace', new Date('2017-12-11')),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2017-12-11')),
          'foo', 21.5, 'trace', new Date('2017-12-11'))
      ]))
  });

  it('fails if an applier fails during replay', () => {
    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([{
        d: 'Test',
        a: 'foo',
        v: 21,
        e: [{n: 'food'}],
      }])))

      .then(() => log.subscribe(log.filter(), () => {
        throw new Error('Nope')
      }))

      .should.be.rejectedWith('Nope')
  });

  it('sorts replayed Records by their time', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([
        {_id: objectId('2013-12-13'), d: 'Test', a: 'foo', v: 21, e: [{n: 'tre'}]},
        {_id: objectId('2013-12-11'), d: 'Test', a: 'bar', v: 22, e: [{n: 'one'}]},
        {_id: objectId('2013-12-12'), d: 'Test', a: 'foo', v: 23, e: [{n: 'two'}]}
      ])))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => records.map(r=>r.event.name).should.eql(['one', 'two', 'tre']))
  });

  it('filters Records by last Record time, Event names and stream ID', () => {
    let records = [];

    let filter = log.filter()
      .after(new Date('2013-12-13T14:15:16Z'))
      .nameIn(['food', 'bard'])
      .ofStream('foo');

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([
        {_id: objectId('2013-12-13T14:15:15Z'), d: 'Test', a: 'foo', e: [{n: 'food', a: 'not'}]},
        {_id: objectId('2013-12-13T14:15:16Z'), d: 'Test', a: 'foo', e: [{n: 'food', a: 'one'}]},
        {_id: objectId('2013-12-13T14:15:17Z'), d: 'Test', a: 'foo', e: [{n: 'nope', a: 'not'}]},
        {_id: objectId('2013-12-13T14:15:18Z'), d: 'Test', a: 'bar', e: [{n: 'food', a: 'not'}]},
        {_id: objectId('2013-12-13T14:15:19Z'), d: 'Test', a: 'foo', e: [{n: 'bard', a: 'two'}, {n: 'not', a: 'tre'}]},
      ])))

      .then(() => log.subscribe(filter, record => records.push(record)))

      .then(() => records.map(r=>r.event.payload).should.eql(['one', 'two', 'tre']))
  });

  it('subscribes to new Records', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => new Promise(y => setTimeout(y, 10)))

      .then(() => onDb(db => db.collection('bla_event_store').insertMany([{
        _id: objectId('2017-12-11'),
        d: 'Test',
        a: 'foo',
        v: 23,
        e: [
          {n: 'food', a: {a: 'b'}, t: new Date('2017-12-13')},
          {n: 'bard', a: {c: 421}}
        ],
        c: 'trace'
      }, {
        _id: objectId('2017-12-12'),
        d: 'Test',
        a: 'foo',
        e: [{n: 'food'}]
      }, {
        d: 'Not Test',
        e: [{n: 'food'}]
      }])))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2017-12-13')),
          'foo', 23, 'trace', new Date('2017-12-11')),
        new k.Record(new k.Event('bard', {c: 421}, new Date('2017-12-11')),
          'foo', 23.5, 'trace', new Date('2017-12-11')),
        new k.Record(new k.Event('food', undefined, new Date('2017-12-12')),
          'foo', 0, undefined, new Date('2017-12-12'))
      ]))
  });

  it('catches error if subscriber fails', () => {
    let logged = [];
    let _error = console.error;
    console.error = err => logged.push(err.toString());

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), () => {
        let error = new Error('Nope');
        error.stack = 'An Error';
        throw error
      }))

      .then(() => new Promise(y => setTimeout(y, 10)))

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({
        d: 'Test',
        e: [{n: 'food'}]
      })))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => console.error = _error)

      .then(() => logged.should.eql(['An Error']))
  });

  it('stops notifying when cancelled', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(subscription => subscription.cancel())

      .then(() => onDb(db => db.collection('bla_event_store').insertOne({d: 'Test', e: [{n: 'food'}]})))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => records.should.eql([]))
  });

  it('infers sequence from Record time for "old" Events since correlation was not kept during migration', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([{
        _id: mongodb.ObjectID('56719a3b0000000000000000'),
        d: 'Test', a: 'foo', v: 21, e: [{n: 'food'}, {n: 'bard'}],
      }, {
        _id: mongodb.ObjectID('56719a3b0000000000000fff'),
        d: 'Test', a: 'foo', v: 22, e: [{n: 'food'}, {n: 'bard'}]
      }, {
        _id: mongodb.ObjectID('56719a3c0000000000000000'),
        d: 'Test', a: 'foo', v: 23, e: [{n: 'food'}, {n: 'bard'}],
      }, {
        _id: mongodb.ObjectID('59bd3ae600000000000003e7'),
        d: 'Test', a: 'foo', v: 24, e: [{n: 'food'}, {n: 'bard'}],
      }, {
        _id: mongodb.ObjectID('59bd3ae70000000000000000'),
        d: 'Test', a: 'foo', v: 42, e: [{n: 'food'}, {n: 'bard'}],
      }])))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => records.map(r=>r.sequence).should.eql([
        0 / 55287980000,
        0.5 / 55287980000,
        95 / 55287980000,
        95.5 / 55287980000,
        1000 / 55287980000,
        1000.5 / 55287980000,
        55287979999 / 55287980000,
        55287979999.5 / 55287980000,
        42,
        42.5,
      ]))
  });

  it('moves seamless from replay to subscription', () => {
    let records = [];

    let i = -1;

    let waitForRecords;
    let stopInserting;

    onDb(db => {
      let keepInserting = setInterval(() => db.collection('bla_event_store').insertOne({
        d: 'Test', a: 'foo', v: i++, e: [{n: 'food', a: i}]
      }), 1);

      return new Promise(y => stopInserting = () => {
        clearInterval(keepInserting);
        y();
      })
    });

    let firstLength = 0;
    return new Promise(y => setTimeout(y, 1000))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => firstLength = records.length)

      .then(() => new Promise(y => waitForRecords = setInterval(() => {
        if (records.length > firstLength) {
          clearInterval(waitForRecords);
          y()
        }
      }, 100)))

      .then(() => stopInserting())

      .then(() => firstLength.should.be.within(1, records.length - 1))

      .then(() => records.map(r=>r.event.payload).should.eql([...new Array(records.length).keys()]))
  }).timeout(10000);

  it('sorts Events within window by sequence', () => {
    let records = [];

    return Promise.resolve()
      .then(() => onDb(db => db.collection('bla_event_store').insertMany([{
        _id: mongodb.ObjectID('6789abcc0000000000000000'),
        d: 'Test', a: 'foo', v: 24, e: [{n: 'foo tre'}],
      }, {
        _id: mongodb.ObjectID('6789abcc0000000000000001'),
        d: 'Test', a: 'bar', v: 23, e: [{n: 'bar two'}],
      }, {
        _id: mongodb.ObjectID('6789abcc0000000000000002'),
        d: 'Test', a: 'bar', v: 20, e: [{n: 'bar one'}],
      }, {
        _id: mongodb.ObjectID('6789abcd0000000000000000'),
        d: 'Test', a: 'foo', v: 22, e: [{n: 'foo two'}],
      }, {
        _id: mongodb.ObjectID('6789abce0000000000000000'),
        d: 'Test', a: 'foo', v: 21, e: [{n: 'foo one'}],
      }, {
        _id: mongodb.ObjectID('6789abcf0000000000000000'),
        d: 'Test', a: 'foo', v: 19, e: [{n: 'foo for'}],
      }])))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => records.map(r=>r.event.name).should.eql([
        'bar one',
        'foo one',
        'foo two',
        'bar two',
        'foo tre',
        'foo for'
      ]))
  })
});