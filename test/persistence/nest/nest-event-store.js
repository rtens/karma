const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const nest = require('../../../src/persistence/nest');
const Datastore = require('nestdb');
const KSUID = require('ksuid');

describe('NestDB Event Store', () => {
  let _Date, db, store;

  beforeEach(() => {
    _Date = Date;
    Date = function (time) {
      return new _Date(time || '2016-12-06');
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;
  });

  afterEach(() => {
    Date = _Date;
  });

  it('stores records', () => {
    db = new Datastore();
    store = new nest.EventStore('Test', db);

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
        .map(d=>({...d, _id: KSUID.parse(d._id).date})).should
        .eql([{
          _id: new Date(),
          mod: 'Test',
          sid: 'foo',
          seq: 1,
          evs: [
            {n: 'food', p: {a: 'b'}, t: new Date('2011-12-13T14:15:16Z')},
            {n: 'bard', p: {c: 123}, t: undefined}
          ],
          tid: 'trace'
        }]))
  })
});