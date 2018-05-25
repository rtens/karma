const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const nest = require('../../../src/persistence/nest');
const Datastore = require('nestdb');

describe('NestDB Event Store', () => {
  let _Date, db, store;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2016-12-06');
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;

    db = new Datastore();
    store = new nest.EventStore('Test', db);

    return store.load()
  });

  afterEach(() => {
    Date = _Date;
  });

  it('stores records', () => {
    let events = [
      new k.Event('food', {a: 'b'}, new Date('2011-12-13T14:15:16Z')),
      new k.Event('bard', {c: 123}, new Date('2016-12-06')),
    ];

    return store.record(events, 'foo', null, 'trace')

      .then(records => records.should.eql([
        new k.Record(new k.Event('food', {a: 'b'}, new Date('2011-12-13T14:15:16Z')), 'foo', 1, 'trace'),
        new k.Record(new k.Event('bard', {c: 123}, new Date('2016-12-06')), 'foo', 2, 'trace')
      ]))

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs
        .should.eql([{
          tid: 'trace',
          tim: new Date(),
          _id: {mod: 'Test', sid: 'foo', seq: 1},
          evs: [
            {nam: 'food', pay: {a: 'b'}, tim: new Date('2011-12-13T14:15:16Z')},
            {nam: 'bard', pay: {c: 123}, tim: undefined}
          ],
        }]))
  });

  it('stores records on sequence', () => {
    return store.record([new k.Event('food', {a: 'b'})], 'foo', 42, 'trace')

      .then(() => new Promise((y, n) => db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(docs => docs
        .should.eql([{
          tid: 'trace',
          tim: new Date(),
          _id: {mod: 'Test', sid: 'foo', seq: 43},
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
          _id: {mod: 'Test', sid: 'foo', seq: 1},
          evs: []
        }]))
  });

  it('rejects Records on occupied heads', () => {
    let record = {_id: {mod: 'Test', sid: 'foo', seq: 42}};

    return new Promise((y, n) => db.insert(record, (err, doc) => err ? n(err) : y(doc)))

      .then(() => store.record([], 'foo', 41))

      .should.be.rejectedWith('Out of sequence')
  });
});