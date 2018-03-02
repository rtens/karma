const karma = require('../../src/karma');

class FakeEventStore extends karma.EventStore {
  constructor() {
    super();
    this.recorded = [];
  }

  record(events, streamId, onSequence, traceId) {
    this.recorded.push({events, streamId, onSequence, traceId});
    return Promise.resolve()
  }
}

class FakeEventLog extends karma.EventLog {
  constructor() {
    super();
    this.records = [];
    this.subscribed = [];
    this.cancelled = [];
  }

  subscribe(subscriptionId, streamHeads, subscriber) {
    this.subscribed.push({subscriptionId, streamHeads: Object.assign({}, streamHeads)});
    this.records.forEach(m => subscriber(m));
    return Promise.resolve();
  }

  cancel(subscriptionId) {
    this.cancelled.push({subscriptionId});
    return Promise.resolve();
  }
}

class FakeSnapshotStore extends karma.SnapshotStore {
  constructor() {
    super();
    this.snapshots = [];
    this.fetched = [];
    this.stored = [];
  }

  store(key, version, snapshot) {
    this.stored.push({key, version, snapshot});
  }

  fetch(key, version) {
    this.fetched.push({key, version});
    var found = this.snapshots.find(s =>
      JSON.stringify(s.key) == JSON.stringify(key) && s.version == version);
    return found ? Promise.resolve(found.snapshot) : Promise.reject()
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventLog: FakeEventLog,
  SnapshotStore: FakeSnapshotStore
};