const mongodb = require('mongodb');
const mongoOplog = require('mongo-oplog');
const karma = require('../../src/karma');

class MongoEventStore extends karma.EventStore {
  constructor(moduleName, connectionUri, database) {
    super(moduleName);
    this._uri = connectionUri;
    this._dbName = database;

    this._client = null;
    this._db = null;
  }

  connect(options) {
    return new mongodb.MongoClient(this._uri, options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.createCollection('event_store'))
      .then(collection => collection.createIndex({a: 1, v: 1}, {unique: true}))
      .catch(err => Promise.reject(new Error('EventStore cannot connect to MongoDB database: ' + err)))
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

class MongoEventLog extends karma.EventLog {
  constructor(moduleName, databaseConnectionUri, oplogConnectionUri, database) {
    super(moduleName);
    this._dbUri = databaseConnectionUri;
    this._oplogUri = oplogConnectionUri;
    this._dbName = database;

    this._subscriptions = [];

    this._client = null;
    this._db = null;
    this._oplog = null;
    this._oplogError = null;
  }

  connect(options) {
    return new mongodb.MongoClient(this._dbUri, options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB database: ' + err)))

      .then(() => this._oplog = mongoOplog(this._oplogUri, {ns: this._dbName + '.event_store'}))
      .then(() => this._oplog.on('error', err => this._oplogError = err))
      .then(() => this._oplog.on('insert', doc => this._notifySubscribers(doc.o, this._subscriptions)))
      .then(() => this._oplog.tail())
      .then(() => this._oplogError ? Promise.reject(this._oplogError) : null)
      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB oplog: ' + err)))
  }

  subscribe(streamHeads, subscriber) {
    let subscription = {subscriber};

    return this._readRecords(streamHeads, subscriber)
      .then(() => this._subscriptions.push(subscription))
      .then(() => ({
        cancel: () => Promise.resolve(subscription.subscriber = null)
          .then(() => this._subscriptions = this._subscriptions.filter(s=>s.subscriber))
      }))
  }

  _readRecords(streamHeads, subscriber) {
    let query = {d: this.module};
    let greaterHeads = Object.keys(streamHeads)
      .map(streamId => ({a: streamId, v: {$gt: streamHeads[streamId]}}));

    if (greaterHeads.length) {
      query.$or = greaterHeads;
    }

    let cursor = this._db
      .collection('event_store')
      .find(query)
      .sort({v: 1});

    return new Promise(y => cursor.forEach(recordSet =>
      this._notifySubscribers(recordSet, [{subscriber}]), y));
  }

  _notifySubscribers(recordSet, subscriptions) {
    if (recordSet.d != this.module) return;

    subscriptions.forEach(s => recordSet.e.forEach((event, i) =>
      s.subscriber(new karma.Record(
        new karma.Event(event.n, event.a, event.t || recordSet._id.getTimestamp()),
        recordSet.a, (recordSet.v || 0) + i, recordSet.c))))
  }

  close() {
    return Promise.all([
      this._client ? this._client.close().then(() => this._client = null) : Promise.resolve(),
      this._oplog ? this._oplog.stop().then(() => this._oplog = null) : Promise.resolve()
    ])
  }
}

module.exports = {
  // PersistenceFactory: MongoPersistenceFactory,
  EventLog: MongoEventLog,
  // SnapshotStore: MongoSnapshotStore,
  EventStore: MongoEventStore
};