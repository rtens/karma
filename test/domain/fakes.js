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
    this.replayed = [];
    this.subscriptions = [];
  }

  publish(record) {
    return Promise.all(Object.values(this.subscriptions).map(s => s.subscriber(record)));
  }

  replay(streamHeads, reader) {
    this.replayed.push({streamHeads: Object.assign({}, streamHeads)});
    this.records.forEach(m => reader(m));
    return Promise.resolve();
  }

  subscribe(subscriber) {
    let subscription = {subscriber, active: true};
    this.subscriptions.push(subscription);

    return {cancel: () => subscription.active = false}
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