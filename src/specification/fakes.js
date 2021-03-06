const chai = require('chai');
const persistence = require('../persistence');
const logging = require('../logging');

class FakeEventStore extends persistence.EventStore {
  constructor(publish) {
    super();
    this.publish = publish || (() => Promise.resolve());
    this.recorded = [];
    this.streams = {};
  }

  record(events, domainName, streamId, onSequence, traceId) {
    this.streams[streamId] = this.streams[streamId] || [];
    events.forEach(event => this.streams[streamId].push(event));

    this.recorded.push({events, domainName, streamId, onSequence, traceId});
    return new Promise(y => process.nextTick(y(super.record(events, domainName, streamId, onSequence, traceId))))
      .then(records => Promise.all(records.map(record => this.publish(record)))
        .then(() => records))
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
      .filter(s => s.filter.matches(record))
      .filter(s => s.active)
      .map(s => s.applier(record)));
  }

  subscribe(filter, applier) {
    this.replayed.push(filter);
    let subscription = {filter, applier, active: true};
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
  //noinspection JSUnusedGlobalSymbols
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

  onStream(domainName, streamId) {
    this.domainName = domainName;
    this.streamId = streamId;
    return this
  }

  matches(record) {
    return !this.lastRecordTime || record.time >= this.lastRecordTime
  }
}

class FakeSnapshotStore extends persistence.SnapshotStore {
  constructor() {
    super();
    this.snapshots = [];
    this.fetched = [];
    this.stored = [];
  }

  store(domainName, unitKey, version, snapshot) {
    if (snapshot.state) {
      const replacer = (k, v) => v === undefined ? null : v;
      const normalize = v => {
        if (v && Array.isArray(v)) {
          return v.map(i => normalize(i))
        } else if (v && typeof v == 'object') {
          return Object.keys(v).reduce((o, k) => ({...o, [k]: normalize(v[k])}), {})
        } else if (v === undefined) {
          return null
        } else {
          return v
        }
      };
      chai.expect(JSON.parse(JSON.stringify(snapshot.state, replacer))).to.eql(normalize(snapshot.state),
        'Snapshot not serializable: ' + domainName + '/' + unitKey);
    }

    this.stored.push({domainName, unitKey, version, snapshot});
    this.snapshots.push({domainName, unitKey, version, snapshot});
    return super.store(domainName, unitKey, version, snapshot);
  }

  fetch(domainName, unitKey, version) {
    this.fetched.push({domainName, unitKey, version});
    let found = this.snapshots
      .find(s => s.domainName == domainName && s.unitKey == unitKey && s.version == version);

    if (!found) return Promise.reject(new Error('No snapshot'));
    return new Promise(y => process.nextTick(() => y(found.snapshot)))
  }
}

class FakeLogger extends logging.Logger {
  constructor() {
    super();
    this.logged = {};
  }

  log(tag, traceId, message) {
    this.logged[tag] = this.logged[tag] || [];
    this.logged[tag].push({traceId, message});
  }
}

module.exports = {
  EventStore: FakeEventStore,
  EventLog: FakeEventLog,
  RecordFilter: FakeRecordFilter,
  SnapshotStore: FakeSnapshotStore,
  Logger: FakeLogger
};