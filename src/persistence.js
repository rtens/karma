const event = require('./event');

class EventLog {

  //noinspection JSUnusedLocalSymbols
  subscribe(filter, applier) {
    return Promise.resolve(new EventLogSubscription())
  }

  filter() {
    return new RecordFilter()
  }
}

class EventLogSubscription {
  cancel() {}
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
  ofStream(domainName, streamId) {
    return this
  }
}

class EventStore {

  record(events, domainName, streamId, onSequence, traceId) {
    onSequence = (onSequence || 0) + 1;
    return Promise.resolve(events.map((e, i) =>
      new event.Record(e, domainName, streamId, onSequence + i, traceId)))
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

  //noinspection JSUnusedLocalSymbols
  store(domainName, key, version, snapshot) {
    return Promise.resolve()
  }

  //noinspection JSUnusedLocalSymbols
  fetch(domainName, key, version) {
    return Promise.reject(new Error('No snapshot'))
  }
}

module.exports = {
  EventStore,
  EventLog,
  EventLogSubscription,
  RecordFilter,
  Snapshot,
  SnapshotStore
};