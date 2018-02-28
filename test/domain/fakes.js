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
    this.snapshots = {};
    this.fetched = [];
    this.stored = [];
  }

  store(id, version, snapshot) {
    this.stored.push({id, version, snapshot});
  }

  fetch(id, version) {
    this.fetched.push({id, version});
    return Promise.resolve(this.snapshots[id + version])
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventBus: FakeEventBus,
  SnapshotStore: FakeSnapshotStore
};