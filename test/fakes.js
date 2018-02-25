let {
  RepositoryStrategy,
  EventBus,
  EventFilter,
  SnapshotStore,
} = require('../index');

class FakeEventBus extends EventBus {
  constructor() {
    super();
    this.published = [];
    this.subscribed = [];
  }

  publish(events, followOffset) {
    this.published.push({events, followOffset});
    return Promise.resolve();
  }

  subscribe(subscriber, filter) {
    this.subscribed.push(filter);
    this.published.forEach(({events}) => events.forEach(subscriber));
    return Promise.resolve();
  }

  filter() {
    return new FakeEventFilter()
  }
}

class FakeEventFilter extends EventFilter {
  nameIsIn(strings) {
    this.names = strings;
    return this
  }

  afterOffset(offset) {
    this.offset = offset;
    return this
  }
}

class FakeRepositoryStrategy extends RepositoryStrategy {
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

class FakeSnapshotStore extends SnapshotStore {
  constructor() {
    super();
    this.snapshots = {};
    this.fetched = [];
    this.stored = [];
  }

  store(id, version, snapshot) {
    this.stored.push({id, version, snapshot});
    this.snapshots[id + version] = snapshot;
  }

  fetch(id, version) {
    this.fetched.push({id, version});
    return Promise.resolve(this.snapshots[id + version])
  }
}

module.exports = {
  FakeEventBus,
  FakeEventFilter,
  FakeRepositoryStrategy,
  FakeSnapshotStore
};