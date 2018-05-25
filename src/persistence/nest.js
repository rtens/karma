const karma = require('../../src/karma');
const Datastore = require('nestdb');

class NestEventStore extends karma.EventStore {
  constructor(moduleName) {
    super(moduleName);

    this._db = new Datastore();
    this._loaded = false;
  }

  record(events, streamId, onSequence, traceId) {
    let insertion = {
      tid: traceId,
      tim: new Date(),
      _id: {
        sid: streamId,
        seq: onSequence + 1
      },
      evs: events.map(event => ({
        nam: event.name,
        pay: event.payload,
        tim: event.time.getTime() == Date.now() ? undefined : event.time
      }))
    };

    return this.load()
      .then(() => new Promise((y, n) => this._db.insert(insertion, (err) => err ? n(err) : y())))
      .then(() => super.record(events, streamId, onSequence, traceId))
      .catch(err => {
        if (err.errorType == 'uniqueViolated') return Promise.reject('Out of sequence');
        return err
      });
  }

  load() {
    if (this._loaded) return Promise.resolve();

    return new Promise((y, n) => this._db.load(err => {
      if (err) return n(err);
      this._loaded = true;
      y();
    }))
  }
}

class NestEventLog extends karma.EventLog {
  constructor(moduleName, dataStore) {
    super(moduleName);

    this._db = dataStore;
    this._loaded = false;

    this._subscriptions = [];
  }

  subscribe(filter, applier) {
    const subscription = {filter, applier};

    return new Promise((y, n) => this._db.find({}, (err, docs) => err ? n(err) : y(docs)))

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

  load() {
    if (this._loaded) return Promise.resolve();

    return new Promise((y, n) => this._db.load(err => {
      if (err) return n(err);
      this._loaded = true;
      y();
    }))

      .then(() => new Promise((y, n) => this._db.ensureIndex({fieldName: 'tim'}, err => err ? n(err) : y())))

      .then(() => new Promise((y, n) => this._db.ensureIndex({fieldName: '_id.sid'}, err => err ? n(err) : y())))

      .then(() => this._db.on('inserted', recordSet => {
        try {
          this._apply(recordSet, this._subscriptions)
        } catch (err) {
          console.error(err.stack ? err.stack : err)
        }
      }))
  }

  _apply(recordSet, subscriptions) {
    subscriptions.forEach(({filter, applier}) => {
      if (!filter.matchesRecordSet(recordSet)) return;

      recordSet.evs.filter(event => filter.matchesEvent(event))
        .forEach((event, i) => applier(this._inflateRecord(recordSet, event, i)))
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
  store(key, version, snapshot) {
    return Promise.resolve()
  }

  fetch(key, version) {
    return Promise.reject(new Error('No snapshot'))
  }
}

class NestPersistenceFactory extends karma.PersistenceFactory {
  eventLog(moduleName) {
    return new EventLog(moduleName)
  }

  snapshotStore(moduleName) {
    return new SnapshotStore(moduleName);
  }

  eventStore(moduleName) {
    return new EventStore(moduleName);
  }
}

module.exports = {
  PersistenceFactory: NestPersistenceFactory,
  EventLog: NestEventLog,
  SnapshotStore: NestSnapshotStore,
  EventStore: NestEventStore
};