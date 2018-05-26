const karma = require('../../src/karma');

class NestEventStore extends karma.EventStore {
  constructor(moduleName, datastore) {
    super(moduleName);
    this._db = datastore;
  }

  record(events, streamId, onSequence, traceId) {
    let insertion = {
      tid: traceId,
      tim: new Date(),
      _id: JSON.stringify({
        sid: streamId,
        seq: (onSequence || 0) + 1
      }),
      evs: events.map(event => ({
        nam: event.name,
        pay: event.payload,
        tim: event.time.getTime() == Date.now() ? undefined : event.time
      }))
    };

    return Promise.resolve()
      .then(() => new Promise((y, n) => this._db.insert(insertion, (err) => err ? n(err) : y())))
      .then(() => super.record(events, streamId, onSequence, traceId))
      .catch(err => {
        if (err.errorType == 'uniqueViolated') return Promise.reject('Out of sequence');
        return err
      });
  }
}

class NestEventLog extends karma.EventLog {
  constructor(moduleName, datastore) {
    super(moduleName);
    this._db = datastore;
    this._subscriptions = [];

    this._db.ensureIndex({fieldName: 'tim'});
    this._db.on('inserted', doc => this._inserted(doc));
  }

  _inserted(recordSet) {
    try {
      this._apply(recordSet, this._subscriptions)
    } catch (err) {
      console.error(err.stack ? err.stack : err)
    }
  }

  subscribe(filter, applier) {
    const subscription = {filter, applier};

    return Promise.resolve()

      .then(() => new Promise((y, n) => this._db.find({}, (err, docs) => err ? n(err) : y(docs))))

      .then(recordSets => recordSets.forEach(recordSet => this._apply(recordSet, [subscription])))

      .then(() => this._subscriptions.push(subscription))

      .then(() => ({
        cancel: () => Promise.resolve(subscription.applier = null)
          .then(() => this._subscriptions = this._subscriptions.filter(s=>s.applier))
      }))
  }

  filter() {
    return new NestRecordFilter()
  }

  _apply(recordSet, subscriptions) {
    let parsedRecordSet = {...recordSet, _id: JSON.parse(recordSet._id)};

    subscriptions.forEach(({filter, applier}) => {
      if (!filter.matchesRecordSet(parsedRecordSet)) return;

      parsedRecordSet.evs.filter(event => filter.matchesEvent(event))
        .forEach((event, i) => applier(this._inflateRecord(parsedRecordSet, event, i)))
    });
  }

  _inflateRecord(recordSet, event, i) {
    return new karma.Record(
      new karma.Event(event.nam, event.pay, event.tim || recordSet.tim),
      recordSet._id.sid, recordSet._id.seq + i, recordSet.tid, recordSet.tim);
  }
}

class NestRecordFilter extends karma.RecordFilter {
  constructor() {
    super();
    this.recordMatchers = [];
    this.eventMatchers = [];
  }

  after(lastRecordTime) {
    this.recordMatchers.push(record => record.tim.getTime() > lastRecordTime.getTime());
    return this
  }

  nameIn(eventNames) {
    this.eventMatchers.push(event => eventNames.indexOf(event.nam) > -1);
    return this
  }

  ofStream(streamId) {
    this.recordMatchers.push(record => record._id.sid == streamId);
    return this
  }

  matchesRecordSet(record) {
    return this.recordMatchers.every(matcher => matcher(record));
  }

  matchesEvent(event) {
    return this.eventMatchers.every(matcher => matcher(event));
  }
}

class NestSnapshotStore extends karma.SnapshotStore {
  constructor(moduleName, datastore) {
    super(moduleName);
    this._db = datastore;
  }

  store(key, version, snapshot) {
    let query = {
      _id: JSON.stringify({
        key: key,
        ver: version
      })
    };

    let update = {
      _id: JSON.stringify({
        key: key,
        ver: version
      }),
      las: snapshot.lastRecordTime,
      had: snapshot.heads,
      sta: snapshot.state
    };

    return new Promise((y, n) =>
      this._db.update(query, update, {upsert: true}, (err) => err ? n(err) : y()))
  }

  fetch(key, version) {
    let query = {
      _id: JSON.stringify({
        key: key,
        ver: version
      })
    };

    return Promise.resolve()

      .then(() => new Promise((y, n) => this._db.findOne(query, (err, doc) => err ? n(err) : y(doc))))

      .then(doc => doc ? doc : Promise.reject(new Error('No snapshot')))

      .then(doc => ({...doc, _id: JSON.parse(doc._id)}))

      .then(doc => new karma.Snapshot(doc.las, doc.had, doc.sta));
  }
}

class NestPersistenceFactory extends karma.PersistenceFactory {
  constructor(recordDatastore, snapshotDatastore) {
    super();

    recordDatastore.load();
    snapshotDatastore.load();

    this._recordDatastore = recordDatastore;
    this._snapshotDatastore = snapshotDatastore;
  }

  eventLog(moduleName) {
    return new NestEventLog(moduleName, this._recordDatastore)
  }

  snapshotStore(moduleName) {
    return new NestSnapshotStore(moduleName, this._snapshotDatastore);
  }

  eventStore(moduleName) {
    return new NestEventStore(moduleName, this._recordDatastore);
  }
}

module.exports = {
  PersistenceFactory: NestPersistenceFactory,
  EventLog: NestEventLog,
  SnapshotStore: NestSnapshotStore,
  EventStore: NestEventStore
};