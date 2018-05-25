const KSUID = require('ksuid');
const karma = require('../../src/karma');

class NestEventStore extends karma.EventStore {
  constructor(moduleName, dataStore) {
    super(moduleName);

    this._dataStore = dataStore;
  }

  record(events, streamId, onSequence, traceId) {
    let ksuid = KSUID.randomSync();
    return this._load()
      .then(() => new Promise((y, n) => this._dataStore.insert({
        _id: ksuid.string,
        tid: traceId,
        mod: this.module,
        sid: streamId,
        seq: 1,
        evs: events.map(event => ({
          n: event.name,
          p: event.payload,
          t: event.time.getTime() == ksuid.date.getTime() ? undefined : event.time
        }))
      }, (err, docs) => err ? n(err) : y(docs))))
      .then(() => super.record(events, streamId, onSequence, traceId));
  }

  _load() {
    return new Promise((y, n) => this._dataStore.load(err => err ? n(err) : y()))
  }
}

class NestEventLog extends karma.EventLog {
  subscribe(filter, applier) {
    return Promise.resolve({cancel: ()=>null})
  }

  filter() {
    return new RecordFilter()
  }
}

class NestRecordFilter extends karma.RecordFilter {
  after(lastRecordTime) {
    return this
  }

  nameIn(eventNames) {
    return this
  }

  ofStream(streamId) {
    return this
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