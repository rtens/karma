const karma = require('../../src/karma');

class EventBus extends karma.EventBus {
  constructor() {
    super();
    this.published = [];
    this.subscribed = [];
    this.unsubscribed = [];
  }

  publish(events, sequenceId, headSequence) {
    this.published.push({events, sequenceId, headSequence});
    return Promise.resolve();
  }

  subscribe(id, subscriber, filter) {
    this.subscribed.push({id, filter});
    this.published.forEach(({events}) => events.forEach(subscriber));
    return Promise.resolve();
  }

  unsubscribe(id) {
    this.unsubscribed.push({id});
  }

  filter() {
    return new EventFilter()
  }
}

class EventFilter extends karma.EventFilter {
  nameIsIn(strings) {
    this.names = strings;
    return this
  }

  after(sequence) {
    this.sequence = sequence;
    return this
  }
}

class RepositoryStrategy extends karma.RepositoryStrategy {
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

class SnapshotStore extends karma.SnapshotStore {
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
  EventBus,
  EventFilter,
  RepositoryStrategy,
  SnapshotStore
};