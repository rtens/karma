const mongodb = require('mongodb');
const mongoOplog = require('mongo-oplog');
const karma = require('../../src/karma');

class MongoEventStore extends karma.EventStore {
  constructor(moduleName, connectionUri, database, collectionPrefix, connectionOptions) {
    super(moduleName);
    this._uri = connectionUri;
    this._dbName = database;
    this._collection = collectionPrefix + 'event_store';
    this._options = connectionOptions;

    this._client = null;
    this._db = null;
  }

  connect() {
    if (this._client) return Promise.resolve();

    return new mongodb.MongoClient(this._uri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.collection(this._collection))
      .then(collection => collection.createIndex({d: 1, a: 1, v: 1}, {unique: true}))
      .catch(err => Promise.reject(new Error('EventStore cannot connect to MongoDB database: ' + err)))
  }

  record(events, streamId, onSequence, traceId) {
    let sequence = Math.floor(onSequence || 0) + 1;

    let document = {
      d: this.module,
      a: streamId,
      v: sequence,
      e: events.map(e => ({n: e.name, a: e.payload, t: this._aboutNow(e.time) ? null : e.time})),
      c: traceId
    };

    return this.connect()
      .then(() => this._db.collection(this._collection).insertOne(document))
      .catch(err => Promise.reject(err.code == 11000 ? new Error('Out of sequence') : err))
      .then(() => events.map((e, i) => new karma.Record(e, streamId, sequence + i, traceId)))
  }

  close() {
    if (this._client) this._client.close();
    this._client = null;
  }

  _aboutNow(time) {
    return Math.abs(time.getTime() - Date.now()) <= 500
  }
}

class MongoEventLog extends karma.EventLog {
  constructor(moduleName, databaseConnectionUri, oplogConnectionUri, database, collectionPrefix, connectionOptions) {
    super(moduleName);
    this._dbUri = databaseConnectionUri;
    this._oplogUri = oplogConnectionUri;
    this._dbName = database;
    this._options = connectionOptions;

    this._collection = collectionPrefix + 'event_store';
    this._subscriptions = [];

    this._client = null;
    this._db = null;
    this._oplog = null;
    this._oplogError = null;
  }

  connect() {
    if (this._client) return Promise.resolve();

    return new mongodb.MongoClient(this._dbUri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.collection(this._collection))
      .then(collection => Promise.all([
        collection.createIndex({d: 1, a: 1, _id: 1}),
        collection.createIndex({d: 1, 'e.n': 1, _id: 1})
      ]))

      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB database: ' + err)))

      .then(() => this._oplog = mongoOplog(this._oplogUri, {ns: this._dbName + '.' + this._collection}))
      .then(() => this._oplog.on('error', err => this._oplogError = err))
      .then(() => this._oplog.on('insert', doc => {
        try {
          this._notifySubscribers(doc.o, this._subscriptions)
        } catch (err) {
          console.error(err.stack ? err.stack : err)
        }
      }))
      .then(() => this._oplog.tail())
      .then(() => this._oplogError ? Promise.reject(this._oplogError) : null)
      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB oplog: ' + err)))
  }

  subscribe(filter, applier) {
    let subscription = {applier};

    return this.connect()
      .then(() => this._replay(filter, applier))
      .then(() => this._subscriptions.push(subscription))
      .then(() => ({
        cancel: () => Promise.resolve(subscription.applier = null)
          .then(() => this._subscriptions = this._subscriptions.filter(s=>s.applier))
      }))
  }

  _replay(filter, applier) {
    return Promise.resolve(this._db
      .collection(this._collection)
      .find(filter.query)
      .sort({_id: 1}))

      .then(cursor => new Promise((y, n) => cursor.forEach(recordSet => {
        try {
          this._notifySubscribers(recordSet, [{applier}])
        } catch (err) {
          n(err)
        }
      }, y)))
  }

  filter() {
    return new MongoRecordFilter(this.module)
  }

  _notifySubscribers(recordSet, subscriptions) {
    if (recordSet.d != this.module) return;

    return subscriptions.forEach(s => recordSet.e.forEach((event, i) =>
      s.applier(this._inflate(recordSet, event, i))))
  }

  _inflate(recordSet, event, i) {
    let sequence = recordSet.v + i / recordSet.e.length;

    let time = recordSet._id.getTimestamp().getTime() / 10;
    if (time < 150557360700) {
      let rest = parseInt(recordSet._id.toHexString().substr(8));
      sequence = (time + (rest % 100) + i / recordSet.e.length - 145028562700) / 5528798000
    }

    return new karma.Record(
      new karma.Event(event.n, event.a, event.t || recordSet._id.getTimestamp()),
      recordSet.a, sequence, recordSet.c, recordSet._id.getTimestamp());
  }

  close() {
    return Promise.all([
      this._client
        ? this._client.close()
        .then(() => this._client = null)
        : Promise.resolve(),
      this._oplog
        ? this._oplog.stop()
        .then(() => this._oplog.destroy())
        .then(() => this._oplog = null)
        : Promise.resolve()
    ])
  }
}

class MongoRecordFilter extends karma.RecordFilter {
  constructor(moduleName) {
    super();
    this.query = {d: moduleName}
  }

  after(lastRecordTime) {
    if (lastRecordTime) {
      this.query._id = {$gte: mongodb.ObjectID.createFromTime(lastRecordTime.getTime() / 1000 - 10)};
    }
    return this
  }

  nameIn(eventNames) {
    this.query['e.n'] = {$in: eventNames};
    return this
  }

  ofStream(streamId) {
    this.query.a = streamId;
    return this
  }
}

class MongoSnapshotStore extends karma.SnapshotStore {
  constructor(moduleName, connectionUri, database, collectionPrefix, connectionOptions) {
    super(moduleName);
    this._uri = connectionUri;
    this._dbName = database;
    this._prefix = collectionPrefix;
    this._options = connectionOptions;

    this._client = null;
    this._db = null;
  }

  connect() {
    if (this._client) return Promise.resolve();

    return new mongodb.MongoClient(this._uri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.collection(this._prefix + 'snapshots_' + this.module))
      .then(collection => collection.createIndex({k: 1, v: 1}))
      .catch(err => Promise.reject(new Error('SnapshotStore cannot connect to MongoDB database: ' + err)))
  }

  store(key, version, snapshot) {
    let filter = {
      k: key,
      v: version
    };
    let document = {
      $set: {
        k: key,
        v: version,
        t: snapshot.lastRecordTime,
        h: snapshot.heads,
        s: snapshot.state
      }
    };

    return this.connect().then(() =>
      this._db.collection(this._prefix + 'snapshots_' + this.module).updateOne(filter, document, {upsert: true}))
  }

  fetch(key, version) {
    return this.connect().then(() => this._db
      .collection(this._prefix + 'snapshots_' + this.module)
      .findOne({k: key, v: version})
      .then(doc => doc ? new karma.Snapshot(doc.t, doc.h, doc.s) : Promise.reject('No snapshot')))
  }

  close() {
    if (this._client) this._client.close();
    this._client = null;
  }
}

class MongoPersistenceFactory extends karma.PersistenceFactory {
  constructor(databaseConnectionUri, oplogConnectionUri, databaseName, collectionPrefix) {
    super();
    this.uri = databaseConnectionUri;
    this.oplogUri = oplogConnectionUri;
    this.db = databaseName;
    this.prefix = collectionPrefix || '';
  }

  eventLog(moduleName) {
    return this._connect(new MongoEventLog(moduleName,
      this.uri, this.oplogUri, this.db, this.prefix))
  }

  snapshotStore(moduleName) {
    return this._connect(new MongoSnapshotStore(moduleName, this.uri, this.db, this.prefix))
  }

  eventStore(moduleName) {
    return this._connect(new MongoEventStore(moduleName, this.uri, this.db, this.prefix))
  }

  _connect(client) {
    client.connect().catch(console.error);
    return client
  }
}

module.exports = {
  PersistenceFactory: MongoPersistenceFactory,
  EventLog: MongoEventLog,
  SnapshotStore: MongoSnapshotStore,
  EventStore: MongoEventStore
};