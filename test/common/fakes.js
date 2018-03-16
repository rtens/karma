const karma = require('../../src/karma');

class FakeEventStore extends karma.EventStore {
  constructor() {
    super();
    this.recorded = [];
  }

  record(events, streamId, onSequence, traceId) {
    this.recorded.push({events, streamId, onSequence, traceId});
    return new Promise(y => process.nextTick(y(super.record(events, streamId, onSequence, traceId))))
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
    return Promise.all(this.subscriptions
      .filter(s => s.active)
      .map(s => s.applier(record)));
  }

  subscribe(applier) {
    let subscription = {applier, active: true};
    this.subscriptions.push(subscription);

    return Promise.resolve({cancel: () => subscription.active = false})
  }

  replay(filter, applier) {
    this.replayed.push(filter);
    return Promise.all(this.records.map(m => applier(m)))
  }

  filter() {
    return new FakeRecordFilter()
  }
}

class FakeRecordFilter extends karma.RecordFilter {
  after(lastRecordTime) {
    this.lastRecordTime = lastRecordTime;
    return this
  }

  nameIn(eventNames) {
    this.eventNames = eventNames;
    return this
  }

  ofStream(streamId) {
    this.streamId = streamId;
    return this
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

    if (!found) return Promise.reject(new Error('No snapshot'));
    return new Promise(y => process.nextTick(() => y(found.snapshot)))
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventLog: FakeEventLog,
  SnapshotStore: FakeSnapshotStore
};