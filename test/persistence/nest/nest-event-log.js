const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _event = require('../../../src/event');
const _nest = require('../../../src/persistence/nest');
const Datastore = require('nestdb');

if (!process.env.TEST_DATA_DIR)
  console.log('Set $TEST_DATA_DIR to test persistent NestDB Event Log');

describe('NestDB Event Log', () => {
  let db, log;

  beforeEach(() => {
    if (process.env.TEST_DATA_DIR) {
      db = new Datastore({filename: process.env.TEST_DATA_DIR + '/Test'})
    } else {
      db = new Datastore();
    }

    log = new _nest.EventLog('Test', db);
    return new Promise((y, n) => db.load(err => err ? n(err) : y()))
  });

  afterEach(() => {
    db.destroy();
  });

  it('creates index for Record time', () => {
    return Promise.resolve()

      .then(() => db.indexes.should.have.all.keys(['_id', 'tim']))
  });

  it('replays stored Records of domain', () => {
    let records = [];

    return Promise.resolve()

      .then(() => new Promise(y => db.insert([
        {
          tid: 'trace',
          tim: new Date('2013-12-11'),
          _id: JSON.stringify({sid: 'foo', seq: 21}),
          evs: [
            {nam: 'food', pay: {a: 'b'}, tim: new Date('2011-12-13')},
            {nam: 'bard', pay: {c: 123}}
          ],
        }
      ], y)))

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => records.should.eql([

        new _event.Record(new _event.Event('food', {a: 'b'}, new Date('2011-12-13')),
          'foo', 21, 'trace', new Date('2013-12-11')),

        new _event.Record(new _event.Event('bard', {c: 123}, new Date('2013-12-11')),
          'foo', 22, 'trace', new Date('2013-12-11'))
      ]))
  });

  it('fails if an applier fails during replay', () => {
    return Promise.resolve()

      .then(() => new Promise(y => db.insert([
        {
          tid: 'trace',
          tim: new Date('2013-12-11'),
          _id: JSON.stringify({sid: 'foo', seq: 21}),
          evs: [{nam: 'food'}],
        }
      ], y)))

      .then(() => log.subscribe(log.filter(), () => {
        throw new Error('Nope')
      }))

      .should.be.rejectedWith('Nope')
  });

  it('subscribes to new Records', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(() => new Promise(y => db.insert([
          {
            tid: 'trace',
            tim: new Date('2013-12-11'),
            _id: JSON.stringify({sid: 'foo', seq: 21}),
            evs: [
              {nam: 'food', pay: {a: 'b'}, tim: new Date('2011-12-13')},
              {nam: 'bard', pay: {c: 123}}
            ],
          }
        ], y))
      )

      .then(() => records.should.eql([

        new _event.Record(new _event.Event('food', {a: 'b'}, new Date('2011-12-13')),
          'foo', 21, 'trace', new Date('2013-12-11')),

        new _event.Record(new _event.Event('bard', {c: 123}, new Date('2013-12-11')),
          'foo', 22, 'trace', new Date('2013-12-11'))
      ]))
  });

  it('filters Records by last Record time, Event names and stream ID', () => {
    let records = [];

    let filter = log.filter()
      .after(new Date('2013-12-15'))
      .nameIn(['food', 'bard'])
      .ofStream('foo');

    return Promise.resolve()

      .then(() => new Promise(y => db.insert([
        {
          tim: new Date('2013-12-15'), _id: JSON.stringify({sid: 'foo', seq: 1}),
          evs: [{nam: 'food', pay: 'not'}]
        },
        {
          tim: new Date('2013-12-16'), _id: JSON.stringify({sid: 'foo', seq: 2}),
          evs: [{nam: 'food', pay: 'one'}]
        },
        {
          tim: new Date('2013-12-17'), _id: JSON.stringify({sid: 'foo', seq: 3}),
          evs: [{nam: 'nope', pay: 'not'}]
        },
        {
          tim: new Date('2013-12-18'), _id: JSON.stringify({sid: 'bar', seq: 4}),
          evs: [{nam: 'food', pay: 'not'}]
        },
        {
          tim: new Date('2013-12-19'), _id: JSON.stringify({sid: 'foo', seq: 5}),
          evs: [{nam: 'bard', pay: 'two'}, {nam: 'nope', pay: 'not'}]
        },
      ], y)))

      .then(() => log.subscribe(filter, record => records.push(record)))

      .then(() => new Promise(y => db.insert([
        {tim: new Date('2013-12-15'), _id: JSON.stringify({sid: 'foo', seq: 6}), evs: [{nam: 'food', pay: 'not'}]},
        {tim: new Date('2013-12-19'), _id: JSON.stringify({sid: 'foo', seq: 7}), evs: [{nam: 'food', pay: 'tre'}]}
      ], y)))

      .then(() => records.map(r=>r.event.payload).should.eql(['one', 'two', 'tre']))
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

      .then(() => new Promise(y => db.insert([
          {
            tim: new Date(),
            _id: JSON.stringify({sid: 'foo', seq: 21}),
            evs: [{nam: 'food'}],
          }
        ], y))
      )

      .then(() => console.error = _error)

      .then(() => logged.should.eql(['An Error']))
  });

  it('stops notifying when cancelled', () => {
    let records = [];

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), record => records.push(record)))

      .then(subscription => subscription.cancel())

      .then(() => new Promise(y => db.insert([
          {
            tim: new Date(),
            _id: JSON.stringify({sid: 'foo', seq: 21}),
            evs: [{nam: 'food'},],
          }
        ], y))
      )

      .then(() => records.should.eql([]))
  });

  it('notifies multiple Logs', () => {
    let records = [];

    let log2 = new _nest.EventLog('Test2', db);

    return Promise.resolve()

      .then(() => log.subscribe(log.filter(), () => null))

      .then(() => log2.subscribe(log2.filter(), record => records.push(record)))

      .then(() => new Promise(y => db.insert([
          {
            tid: 'trace',
            tim: new Date('2011-12-13'),
            _id: JSON.stringify({sid: 'foo', seq: 21}),
            evs: [{nam: 'food'}],
          }
        ], y))
      )

      .then(() => records.should.eql([

        new _event.Record(new _event.Event('food', undefined, new Date('2011-12-13')),
          'foo', 21, 'trace', new Date('2011-12-13')),
      ]))
  });
});