const karma = require('../../src/karma');

class FakeEventStore extends karma.EventStore {
  constructor() {
    super();
    this.records = [];
    this.recorded = [];
    this.readers = [];
    this.detached = [];
  }

  record(events, aggregateId, onRevision, traceId) {
    this.recorded.push({events, aggregateId, onRevision, traceId});
    return Promise.resolve()
  }

  read(aggregateId, recordReader, filter) {
    this.readers.push({aggregateId, filter});
    this.records.forEach(r => recordReader(r));
    return Promise.resolve()
  }

  detach(aggregateId) {
    this.detached.push({aggregateId});
  }

  filter() {
    return new FakeRecordFilter()
  }
}

class FakeRecordFilter extends karma.RecordFilter {
  nameIsIn(strings) {
    this.names = strings;
    return this
  }

  after(revision) {
    this.revision = revision;
    return this
  }
}

class FakeEventBus extends karma.EventBus {
  constructor() {
    super();
    this.published = [];
  }

  publish(event, domain) {
    this.published.push({event, domain});
    return Promise.resolve()
  }

  subscribe(subscriberId, messageSubscriber, messageFilter) {
    return Promise.resolve()
  }

  unsubscribe(subscriberId) {
    return Promise.resolve()
  }

  filter() {
    return new MessageFilter();
  }
}

class FakeMessageFilter extends karma.MessageFilter {
  after(offset) {
    return this
  }

  from(domain) {
    return this
  }
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