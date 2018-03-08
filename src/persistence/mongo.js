const mongodb = require('mongodb');
const karma = require('../../src/karma');

class MongoEventStore extends karma.EventStore {
  constructor(moduleName, connectionUrl, database) {
    super(moduleName);
    this._url = connectionUrl;
    this._dbName = database;
    this._client = null;
    this._db = null;
  }

  connect(options) {
    return new mongodb.MongoClient(this._url, options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.createCollection('event_store'))
      .then(collection => collection.createIndex({a: 1, v: 1}, {unique: true}))
      .then(() => this)
      .catch(err => Promise.reject(new Error('Cannot connect to MongoDB: ' + err)))
  }

  record(events, streamId, onSequence, traceId) {
    let document = {
      d: this.module,
      a: streamId,
      v: onSequence,
      e: events.map(e => ({n: e.name, a: e.payload, t: e.time})),
      c: traceId
    };

    return this._db.collection('event_store').insertOne(document)
      .catch(err => Promise.reject(err.code == 11000 ? new Error('Out of sequence') : err))
      .then(() => super.record(events, streamId, onSequence, traceId))
  }

  close() {
    this._client.close()
  }
}

module.exports = {
  // PersistenceFactory: MongoPersistenceFactory,
  // EventLog: MongoEventLog,
  // SnapshotStore: MongoSnapshotStore,
  EventStore: MongoEventStore
};