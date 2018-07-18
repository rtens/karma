const _persistence = require('../../src/persistence');
const _event = require('../../src/event');

const mongodb = require('mongodb');
const mongoOplog = require('mongo-oplog');
const BSON = require('bson');
const debug = {
  snapshot: require('debug')('karma:snapshot'),
  replay: require('debug')('karma:replay')
};

class MongoEventStore extends _persistence.EventStore {
  constructor(connectionUri, databaseName, collectionPrefix = '', connectionOptions = {}) {
    super();
    this._uri = connectionUri;
    this._dbName = databaseName;
    this._collection = collectionPrefix + 'event_store';
    this._options = connectionOptions;

    this._client = null;
    this._db = null;

    this._connecting = false;
    this._onConnected = [];
  }

  connect() {
    if (this._client) return Promise.resolve();
    if (this._connecting) return new Promise(y => this._onConnected.push(y));

    this._connecting = true;
    return new mongodb.MongoClient(this._uri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.collection(this._collection))
      .then(collection => collection.createIndex({d: 1, a: 1, v: 1}, {unique: true}))
      .then(() => this._onConnected.forEach(fn=>fn()))
      .catch(err => Promise.reject(new Error('EventStore cannot connect to MongoDB database: ' + err)))
  }

  record(events, domainName, streamId, onSequence, traceId) {
    let sequence = Math.floor(onSequence || 0) + 1;

    let document = {
      d: domainName,
      a: streamId,
      v: sequence,
      e: events.map(e => ({n: e.name, a: e.payload, t: this._aboutNow(e.time) ? null : e.time})),
      c: traceId
    };

    return this.connect()
      .then(() => this._db.collection(this._collection).insertOne(document))
      .catch(err => Promise.reject(err.code == 11000 ? new Error('Out of sequence') : err))
      .then(() => events.map((e, i) => new _event.Record(e, domainName, streamId, sequence + i, traceId)))
  }

  close() {
    if (this._client) this._client.close();
    this._client = null;
  }

  _aboutNow(time) {
    return Math.abs(time.getTime() - Date.now()) <= 500
  }
}

class MongoEventLog extends _persistence.EventLog {
  constructor(databaseConnectionUri, oplogConnectionUri, database, collectionPrefix = '', connectionOptions = {}) {
    super();
    this._dbUri = databaseConnectionUri;
    this._oplogUri = oplogConnectionUri;
    this._dbName = database;
    this._options = connectionOptions;

    this._collection = collectionPrefix + 'event_store';
    this._subscriptions = [];
    this._buffer = [];

    this._client = null;
    this._db = null;
    this._oplog = null;
    this._oplogError = null;

    this._connecting = false;
    this._onConnected = [];
  }

  connect() {
    if (this._client) return Promise.resolve();
    if (this._connecting) return new Promise(y => this._onConnected.push(y));

    this._connecting = true;
    return new mongodb.MongoClient(this._dbUri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._db.collection(this._collection))
      .then(collection => Promise.all([
        collection.createIndex({_id: 1, d: 1, a: 1}),
        collection.createIndex({_id: 1, 'e.n': 1})
      ]))

      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB database: ' + err)))

      .then(() => this._oplog = mongoOplog(this._oplogUri, {ns: this._dbName + '.' + this._collection}))
      .then(() => this._oplog.on('error', err => this._oplogError = err))
      .then(() => this._oplog.on('insert', doc => {
        this._notifySubscribers(doc.o, this._subscriptions);

        setTimeout(() => {
          try {
            this._flushBuffer()
          } catch (err) {
            console.error(err.stack ? err.stack : err)
          }
        }, 10);
      }))
      .then(() => this._oplog.tail())
      .then(() => this._oplogError ? Promise.reject(this._oplogError) : null)
      .then(() => this._onConnected.forEach(fn=>fn()))
      .catch(err => Promise.reject(new Error('EventLog cannot connect to MongoDB oplog: ' + err)))
  }

  subscribe(filter, applier) {
    let heads = {};
    let subscription = {applier};

    return this.connect()
      .then(() => this._replay(filter, record => {
        heads[record.streamId] = record.sequence;
        applier(record)
      }))
      .then(() => subscription.applier = record => record.sequence > (heads[record.streamId] || -1)
        ? applier(record)
        : null)
      .then(() => this._subscriptions.push(subscription))
      .then(() => ({
        cancel: () => Promise.resolve(subscription.applier = null)
          .then(() => this._subscriptions = this._subscriptions.filter(s=>s.applier))
      }))
  }

  _replay(filter, applier) {
    let cursor = this._db
      .collection(this._collection)
      .find(filter.query)
      .sort({_id: 1});

    let first = Promise.resolve();

    let totalCount = 1000000;
    let currentCount = 0;

    if (debug.replay.enabled) {
      first = new Promise(y => cursor.count((err, count) => {
        if (err) return y(debug.replay('Error counting [%j]: %s', filter.query, err));

        debug.replay('%d %j', count, filter.query);
        totalCount = count;
        y();
      }));
    }

    return first
      .then(() => new Promise((y, n) => cursor.forEach(recordSet => {
        if (debug.replay.enabled) {
          currentCount++;
          const increment = Math.max(10000, Math.ceil(.01 * totalCount));
          if (currentCount == totalCount || currentCount % increment == 0)
            debug.replay('%d%% * %d', Math.floor((currentCount / totalCount) * 100), totalCount);
        }

        try {
          this._notifySubscribers(recordSet, [{applier}])
        } catch (err) {
          n(err)
        }
      }, y)))
      .then(() => this._flushBuffer())
  }

  filter() {
    return new MongoRecordFilter()
  }

  _notifySubscribers(recordSet, subscriptions) {
    this._buffer.push({recordSet, subscriptions});
    let times = this._buffer.map(({recordSet}) => recordSet._id.getTimestamp().getTime());
    let first = Math.min(...times);
    let last = Math.max(...times);

    if (last - first > 2000) {
      this._flushBuffer(first + 2000);
    }
  }

  _flushBuffer(until) {
    this._buffer.sort((a, b) => a.recordSet.v - b.recordSet.v);
    this._buffer = this._buffer.filter(({recordSet, subscriptions}) => {
      if (recordSet._id.getTimestamp().getTime() > until) return true;

      recordSet.e.forEach((event, i) => {
        let record = this._inflate(recordSet, event, i);
        subscriptions.forEach(subscription =>
          subscription.applier(record))
      });
      return false
    })
  }

  _inflate(recordSet, event, i) {
    let sequence = (recordSet.v || 0) + i / recordSet.e.length;

    let time = recordSet._id.getTimestamp().getTime();
    if (time < 1505573607000) {
      let rest = parseInt(recordSet._id.toHexString().substr(21), 16);
      sequence = (time + (rest % 1000) + i / recordSet.e.length - 1450285627000) / 55287980000
    }

    return new _event.Record(
      new _event.Event(event.n, event.a, event.t || recordSet._id.getTimestamp()),
      recordSet.d, recordSet.a, sequence, recordSet.c, recordSet._id.getTimestamp());
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

class MongoRecordFilter extends _persistence.RecordFilter {
  constructor() {
    super();
    this.query = {};
  }

  after(lastRecordTime) {
    if (lastRecordTime) {
      this.query._id = {$gte: mongodb.ObjectID.createFromTime(lastRecordTime.getTime() / 1000)};
    }
    return this
  }

  nameIn(eventNames) {
    this.query['e.n'] = {$in: eventNames};
    return this
  }

  onStream(domainName, streamId) {
    this.query.d = domainName;
    this.query.a = streamId;
    return this
  }
}

class MongoSnapshotStore extends _persistence.SnapshotStore {
  constructor(connectionUri, database, collectionPrefix = '', connectionOptions = {}) {
    super();
    this._uri = connectionUri;
    this._dbName = database;
    this._prefix = collectionPrefix;
    this._options = connectionOptions;

    this._client = null;
    this._db = null;
    this._snapshots = null;

    this._connecting = false;
    this._onConnected = [];
  }

  connect() {
    if (this._client) return Promise.resolve();
    if (this._connecting) return new Promise(y => this._onConnected.push(y));

    this._connecting = true;
    return new mongodb.MongoClient(this._uri, this._options).connect()
      .then(client => this._client = client)
      .then(client => this._db = client.db(this._dbName))
      .then(() => this._snapshots = this._db.collection(this._prefix + 'snapshots'))
      .then(() => this._snapshots.createIndex({d: 1, k: 1, v: 1}))
      .then(() => this._onConnected.forEach(fn=>fn()))
      .catch(err => Promise.reject(new Error('SnapshotStore cannot connect to MongoDB database: ' + err)))
  }

  store(domainName, unitKey, version, snapshot) {
    let filter = {
      d: domainName,
      k: unitKey,
      v: version
    };
    let document = {
      $set: {
        d: domainName,
        k: unitKey,
        v: version,
        t: snapshot.lastRecordTime,
        h: snapshot.heads,
        s: JSON.stringify(snapshot.state)
      }
    };

    if (debug.snapshot.enabled) {
      debug.snapshot('%j', {domainName, unitKey, version, size: new BSON().calculateObjectSize(document.$set)});
    }

    return this.connect().then(() =>
      this._snapshots.updateOne(filter, document, {upsert: true}))
  }

  fetch(domainName, unitKey, version) {
    return this.connect().then(() =>
      this._snapshots
        .findOne({d: domainName, k: unitKey, v: version})
        .then(doc => doc ? new _persistence.Snapshot(doc.t, doc.h, JSON.parse(doc.s)) : Promise.reject('No snapshot')))
  }

  close() {
    if (this._client) this._client.close();
    this._client = null;
  }
}

module.exports = {
  EventLog: MongoEventLog,
  SnapshotStore: MongoSnapshotStore,
  EventStore: MongoEventStore
};