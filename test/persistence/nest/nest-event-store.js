const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../../../src/event');
const _nest = require('../../../src/persistence/nest');
const Datastore = require('nestdb');

if (!process.env.TEST_DATA_DIR)
  console.log('Set $TEST_DATA_DIR to test persistent NestDB Event Store');

describe.skip('NestDB Event Store', () => {
  let _Date, db, store;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2016-12-06');
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;

    if (process.env.TEST_DATA_DIR) {
      db = new Datastore({filename: process.env.TEST_DATA_DIR + '/Test'})
    } else {
      db = new Datastore();
    }

    store = new _nest.EventStore('Test', db);
    return new Promise((y, n) => db.load(err => err ? n(err) : y()))
  });

  afterEach(() => {
    Date = _Date;
    db.destroy();
  });

  it('stores records', () => {
    let events = [
      new _event.Event('food', {a: 'b'}, new Date('2011-12-13T14:15:16Z')),
      new _event.Event('bard', {c: 123}, new Date('2016-12-06')),
    ];

    return store.record(events, 'foo', undefined, 'trace')

      .then(records => records.should.eql([
        new _event.Record(new _event.Event('food', {a: 'b'}, new Date('2011-12-13T14:15:16Z')), 'foo', 1, 'trace'),
        new _event.Record(new _event.Event('bard', {c: 123}, new Date('2016-12-06')), 'foo', 2, 'trace')
      ]))

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs
        .should.eql([{
          tid: 'trace',
          tim: new Date(),
          _id: JSON.stringify({sid: 'foo', seq: 1}),
          evs: [
            {nam: 'food', pay: {a: 'b'}, tim: new Date('2011-12-13T14:15:16Z')},
            {nam: 'bard', pay: {c: 123}, tim: undefined}
          ],
        }]))
  });

  it('stores records on sequence', () => {
    return store.record([new _event.Event('food', {a: 'b'})], 'foo', 42, 'trace')

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs
        .should.eql([{
          tid: 'trace',
          tim: new Date(),
          _id: JSON.stringify({sid: 'foo', seq: 43}),
          evs: [
            {nam: 'food', pay: {a: 'b'}, tim: undefined}
          ],
        }]))
  });

  it('records empty events', () => {
    return store.record([], 'foo', null, 'trace')

      .then(records => records.should.eql([]))

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs
        .should.eql([{
          tid: 'trace',
          tim: new Date(),
          _id: JSON.stringify({sid: 'foo', seq: 1}),
          evs: []
        }]))
  });

  it('rejects Records on occupied heads', () => {
    let record = {_id: JSON.stringify({sid: 'foo', seq: 42})};

    return Promise.resolve()

      .then(() => new Promise((y, n) => db.insert(record, (err, doc) => err ? n(err) : y(doc))))

      .then(() => store.record([], 'foo', 41))

      .should.be.rejectedWith('Out of sequence')
  });

  if (process.env.TEST_DATA_DIR)
    it('keep Records on reloading', () => {
      return Promise.resolve()

        .then(() => store.record([new _event.Event('food')], 'foo', 0))

        .then(() => store.record([new _event.Event('food')], 'foo', 1))

        .then(() => store.record([new _event.Event('food')], 'foo', 2))

        .then(() => new Promise((y, n) => db.load(err => err ? n(err) : y())))

        .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

        .then(docs => docs.length.should.equal(3))
    })
});