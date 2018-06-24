const event = require('./event');

class EventLog {
  constructor(domainName) {
    this.domain = domainName;
  }

  //noinspection JSUnusedLocalSymbols
  subscribe(filter, applier) {
    return Promise.resolve({cancel: ()=>null})
  }

  filter() {
    return new RecordFilter()
  }
}

class RecordFilter {
  //noinspection JSUnusedLocalSymbols
  after(lastRecordTime) {
    return this
  }

  //noinspection JSUnusedLocalSymbols
  nameIn(eventNames) {
    return this
  }

  //noinspection JSUnusedLocalSymbols
  ofStream(streamId) {
    return this
  }
}

class CombinedEventLog extends EventLog {
  constructor(eventLogs) {
    super();
    this._logs = eventLogs;
  }

  subscribe(filter, applier) {
    return Promise.all(this._logs.map((log, i) => log.subscribe(filter.at(i), applier)))
      .then(subscriptions => ({cancel: () => subscriptions.forEach(s => s.cancel())}))
  }

  filter() {
    return new CombinedRecordFilter(this._logs.map(l=>l.filter()))
  }
}

class CombinedRecordFilter extends RecordFilter {
  constructor(filters) {
    super();
    this._filters = filters;
  }

  at(index) {
    return this._filters[index];
  }

  after(lastRecordTime) {
    this._filters.forEach(f=>f.after(lastRecordTime));
    return this
  }

  nameIn(eventNames) {
    this._filters.forEach(f=>f.nameIn(eventNames));
    return this
  }

  ofStream(streamId) {
    this._filters.forEach(f=>f.ofStream(streamId));
    return this
  }
}

class EventStore {
  constructor(domainName) {
    this.domain = domainName;
  }

  record(events, streamId, onSequence, traceId) {
    return Promise.resolve(events.map((e, i) =>
      new event.Record(e, streamId, (onSequence || 0) + 1 + i, traceId)))
  }
}

class PersistenceFactory {
  eventLog(domainName) {
    return new EventLog(domainName)
  }

  snapshotStore(domainName) {
    return new SnapshotStore(domainName);
  }

  eventStore(domainName) {
    return new EventStore(domainName);
  }
}

class Snapshot {
  constructor(lastRecordTime, heads, state) {
    this.lastRecordTime = lastRecordTime;
    this.heads = heads;
    this.state = state;
  }
}

class SnapshotStore {
  constructor(domainName) {
    this.domain = domainName;
  }

  //noinspection JSUnusedLocalSymbols
  store(key, version, snapshot) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  fetch(key, version) {
    return Promise.reject(new Error('No snapshot'))
  }
}

module.exports = {
  EventStore,
  EventLog,
  CombinedEventLog,
  RecordFilter,
  PersistenceFactory,
  Snapshot,
  SnapshotStore
};