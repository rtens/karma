const karma = require('../../src/karma');

class NestEventStore extends karma.EventStore {
  constructor(moduleName, dataStore) {
    super(moduleName);

    this._dataStore = dataStore;
    this._loaded = false;
  }

  record(events, streamId, onSequence, traceId) {
    let insertion = {
      tid: traceId,
      tim: new Date(),
      _id: {
        mod: this.module,
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
      .then(() => new Promise((y, n) => this._dataStore.insert(insertion, (err) => err ? n(err) : y())))
      .then(() => super.record(events, streamId, onSequence, traceId))
      .catch(err => {
        if (err.errorType == 'uniqueViolated') return Promise.reject('Out of sequence');
        return err
      });
  }

  load() {
    if (this._loaded) return Promise.resolve();

    return new Promise((y, n) => this._dataStore.load(err => {
      if (err) return n(err);
      this._loaded = true;
      y();
    }))
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