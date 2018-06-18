const persistence = require('../persistence');

class FakeEventStore extends persistence.EventStore {
  constructor() {
    super();
    this.recorded = [];
  }

  record(events, streamId, onSequence, traceId) {
    this.recorded.push({events, streamId, onSequence, traceId});
    return new Promise(y => process.nextTick(y(super.record(events, streamId, onSequence, traceId))))
  }
}

class FakeEventLog extends persistence.EventLog {
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
      return Promise.all(this.records
        .filter(r => filter.matches(r))
        .map(r => applier(r)))
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

class FakeRecordFilter extends persistence.RecordFilter {
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

  matches(record) {
    return (!this.streamId || record.streamId == this.streamId)
      && (!this.lastRecordTime || record.time >= this.lastRecordTime);
  }
}

class FakeSnapshotStore extends persistence.SnapshotStore {
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

class FakeServer {
  constructor() {
    this.handlers = {GET: {}, POST: {}};
  }

  get(route, handler) {
    this.handlers.GET[route] = handler
  }

  post(route, handler) {
    this.handlers.POST[route] = handler
  }

  use(route, handler) {
    this.get(route, handler);
    this.post(route, handler);
  }
}

class FakeRequest {
  constructor(method, route) {
    this.method = method.toUpperCase();
    this.route = route;
    this.params = {};
    this.query = {};
  }

  execute(server) {
    if (!server.handlers[this.method][this.route]) {
      return Promise.reject(new Error(`No handler for [${this.method.toUpperCase()} ${this.route}] registered`))
    }

    let response = new FakeResponse();
    return new Promise(y => y(server.handlers[this.method][this.route](this, response)))
      .then(() => response)
  }
}

class FakeResponse {
  constructor() {
    this.headers = {};
    this.statusCode = 200;
    this.body = null;
  }

  setHeader(field, value) {
    this.headers[field] = value;
  }

  //noinspection JSUnusedGlobalSymbols
  header(field, value) {
    this.setHeader(field, value);
  }

  set(field, value) {
    this.setHeader(field, value);
  }

  status(code) {
    this.statusCode = code;
    return this
  }

  send(body) {
    if (Buffer.isBuffer(body)) body = body.toString();
    this.body = body;

    try {
      this.body = JSON.parse(this.body);
    } catch (ignored) {
    }
  }

  end(body) {
    this.send(body)
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventLog: FakeEventLog,
  RecordFilter: FakeRecordFilter,
  SnapshotStore: FakeSnapshotStore,
  Server: FakeServer,
  Request: FakeRequest
};