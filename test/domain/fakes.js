const karma = require('../../src/karma');

class FakeEventStore extends karma.EventStore {
  constructor(domain) {
    super(domain);
    this.messages = [];
    this.recorded = [];
    this.attached = [];
    this.detached = [];
  }

  record(events, aggregateId, onRevision, traceId) {
    this.recorded.push({events, aggregateId, onRevision, traceId});
    return Promise.resolve()
  }

  attach(unit) {
    this.attached.push({unitId: unit.id});
    this.messages.forEach(m => unit.apply(m));
    return Promise.resolve()
  }

  detach(unit) {
    this.detached.push({unitId: unit.id});
  }
}

class FakeEventBus extends karma.EventBus {
  constructor(domain) {
    super(domain);
    this.messages = [];
    this.recorded = [];
    this.attached = [];
    this.detached = [];
  }

  attach(unit) {
    this.attached.push({unitId: unit.id});
    this.messages.forEach(m => unit.apply(m));
    return Promise.resolve()
  }

  detach(unit) {
    this.detached.push({unitId: unit.id});
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
  EventBus: FakeEventBus,
  SnapshotStore: FakeSnapshotStore
};