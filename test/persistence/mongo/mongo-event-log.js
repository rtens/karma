if (!process.env.MONGODB_URI_TEST)
  return console.log('Set $MONGODB_URI_TEST to test MongoEventLog');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../src/karma');
const mongo = require('../../../src/persistence/mongo');
const mongodb = require('mongodb');

describe('MongoDB Event Log', () => {
  let store, onDb;

  beforeEach(() => {
    let db = 'karma3_' + Date.now() + Math.round(Math.random() * 1000);
    store = new mongo.EventStore('Test', process.env.MONGODB_URI_TEST, db);

    onDb = execute => {
      let result = null;
      return mongodb.MongoClient.connect(process.env.MONGODB_URI_TEST)
        .then(client => Promise.resolve(execute(client.db(db)))
          .then(r => result = r)
          .catch(e => client.close() && console.error(e))
          .then(() => client.close()))
        .then(() => result)
    }
  });

  afterEach(() => {
    return onDb(db => db.dropDatabase())
  });

  it('fails if it cannot connect');

  it('replays stored Records in sequence');

  it('filters Records by sequence heads');

  it('notifies about new Records');

  it('combines replay and notification');

  it('stops notifying when cancelled');
});