const karma = require('../../src/karma');

class FakeEventStore extends karma.EventStore {
  constructor(domain) {
    super(domain);
    this.records = [];
    this.recorded = [];
    this.attached = [];
    this.detached = [];
  }

  record(events, aggregateId, onRevision, traceId) {
    this.recorded.push({events, aggregateId, onRevision, traceId});
    return Promise.resolve()
  }

  attach(aggregate) {
    this.attached.push({aggregateId: aggregate.id});
    this.records.forEach(r => aggregate.apply(new karma.Message(r.event, this._domain, r.revision)));
    return Promise.resolve()
  }

  detach(aggregate) {
    this.detached.push({aggregateId: aggregate.id});
  }
}

class FakeEventBus extends karma.EventBus {
}

class FakeRepositoryStrategy extends karma.RepositoryStrategy {
  constructor() {
    super();
    this._onAccess = ()=>null;
  }

  onAccess(callback) {
    this._onAccess = callback;
    return this
  }

  notifyAccess(unit) {
    this._onAccess(unit)
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
  RepositoryStrategy: FakeRepositoryStrategy,
  SnapshotStore: FakeSnapshotStore
};