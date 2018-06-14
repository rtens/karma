const karma = require('./karma');

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
    this.subscribed = [];
    this.subscriptions = [];
  }

  publish(record) {
    return Promise.all(this.subscriptions
      .filter(s => s.active)
      .map(s => s.applier(record)));
  }

  subscribe(filter, applier) {
    this.replayed.push(filter);
    let subscription = {applier, active: true};
    this.subscribed.push({filter, subscription});

    try {
      return Promise.all(this.records.map(m => applier(m)))
        .then(() => this.subscriptions.push(subscription))
        .then(() => ({cancel: () => subscription.active = false}))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  filter() {
    return new FakeRecordFilter()
  }
}

class FakeRecordFilter extends karma.RecordFilter {
  named(name) {
    this.name = name;
    return this
  }

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
    this.snapshots.push({key, version, snapshot});
    return super.store(key, version, snapshot);
  }

  fetch(key, version) {
    this.fetched.push({key, version});
    let found = this.snapshots.find(s => s.key == key && s.version == version);
    if (!found) return Promise.reject(new Error('No snapshot'));
    return new Promise(y => process.nextTick(() => y(found.snapshot)))
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventLog: FakeEventLog,
  RecordFilter: FakeRecordFilter,
  SnapshotStore: FakeSnapshotStore
};