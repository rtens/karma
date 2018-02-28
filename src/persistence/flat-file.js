const fs = require('fs');
const path = require('path');
const lockFile = require('lockfile');
const chokidar = require('chokidar');
const Promise = require("bluebird");
const queue = require('queue');

const karma = require('../karma');

Promise.promisifyAll(fs);
Promise.promisifyAll(lockFile);

class FlatFileEventStore extends karma.EventStore {
  constructor(baseDir) {
    super();
    this._dir = baseDir;
    this._subscriptions = {};
    this._notified = {};
    this._notificationQueue = queue({concurrency: 1, autostart: true});

    FlatFileEventStore._mkdir(baseDir);
    FlatFileEventStore._mkdir(baseDir + '/events');

    this._watcher = chokidar.watch(baseDir + '/events');
    this._watcher.on('add', (file) =>
      this._notificationQueue.push(() => this._notifyAllSubscribers(file)))
  }

  _notifyAllSubscribers(file) {
    return Promise.all(Object.keys(this._subscriptions)
      .map(id => this._notifySubscribers(file, id, this._subscriptions[id])))
  }

  _notifySubscribers(file, subscriptionId, subscriptions) {
    if (file in this._notified[subscriptionId]) {
      return Promise.resolve();
    }
    this._notified[subscriptionId][file] = true;

    return fs.readFileAsync(file)

      .then(content => JSON.parse(content))

      .then(event => subscriptions
        .filter(subscription => !subscription.filter || subscription.filter.matches(event))
        .forEach(subscription => subscription.subscriber(event)));
  }

  publish(events, sequenceId, headSequence) {
    return Promise.resolve()
      .then(() => this._aquireLock())
      .then(() => this._readWriteFile())
      .then(write => this._guardHeads(write, sequenceId, headSequence))
      .then(write => this._writeEvents(write, events))
      .then(write => this._writeWriteFile(write, events, sequenceId))
      .then(() => this._releaseLock())
      .catch(e => this._releaseLock().then(() => Promise.reject(e)))
      .then(() => this)
  }

  _aquireLock() {
    return lockFile.lockAsync(this._dir + '/write.lock', {wait: 100, pollPeriod: 10})
      .catch(e => Promise.reject(new Error('Locked')))
  }

  _releaseLock() {
    return lockFile.unlockAsync(this._dir + '/write.lock')
  }

  _readWriteFile() {
    return fs.readFileAsync(this._dir + '/write')
      .then(writeContent => JSON.parse(writeContent))
      .catch(() => ({revision: 0, heads: {}}))
  }

  _guardHeads(write, sequenceId, headSequence) {
    if (sequenceId && sequenceId in write.heads && write.heads[sequenceId] != headSequence) {
      throw new Error('Head occupied.');
    }
    return write;
  }

  _writeEvents(write, events) {
    return Promise.each(events
        .map((event, i) => event.withSequence(write.revision + i + 1))
        .map(event => ({event: JSON.stringify(event, null, 2), revision: event.revision})),
      content => fs.writeFileAsync(this._dir + '/events/' + content.revision, content.event)
    )
      .then(() => write)
  }

  _writeWriteFile(write, events, sequenceId) {
    write = {
      sequence: write.revision + events.length,
      heads: !sequenceId
        ? write.heads
        : {...write.heads, [sequenceId]: write.revision + events.length}
    };

    return fs.writeFileAsync(this._dir + '/write', JSON.stringify(write, null, 2));
  }

  subscribe(id, subscriber, filter) {
    this._notified[id] = this._notified[id] || {};

    return fs.readdirAsync(this._dir + '/events')

      .then(files => files.sort((a, b) => parseInt(a) - parseInt(b)))

      .then(files => Promise.each(files, file =>
          this._notifySubscribers(this._dir + '/events/' + file, id, [{filter, subscriber}]),
        {concurrency: 1}))

      .then(() => (this._subscriptions[id] = this._subscriptions[id] || [])
        .push({filter, subscriber}))

      .then(() => this)
  }

  unsubscribe(id) {
    delete this._notified[id];
    delete this._subscriptions[id];
    return Promise.resolve(this);
  }

  close() {
    return new Promise(y => setTimeout(() => this._close(y), 100));
  }

  _close(y) {
    if (this._notificationQueue.length == 0) {
      return y(this._watcher.close());
    }
    setTimeout(() => this._close(y), 100)
  }

  filter() {
    return new RecordFilter()
  }

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
}

class RecordFilter {
  nameIsIn(strings) {
    this.names = strings;
    return this;
  }

  after(sequence) {
    this._after = sequence;
    return this;
  }

  matches(event) {
    return (!this.names || this.names.indexOf(event.name) > -1)
      && (!this._after || event.revision > this._after);
  }
}

class FlatFileSnapshotStore extends karma.SnapshotStore {
  constructor(baseDir) {
    super();
    this._dir = baseDir;

    FlatFileSnapshotStore._mkdir(baseDir);
    FlatFileSnapshotStore._mkdir(baseDir + '/snapshots');
  }

  store(id, version, snapshot) {
    var path = this._dir + '/snapshots/' + id;
    FlatFileSnapshotStore._mkdir(path);

    return fs.writeFileAsync(path + '/' + version, JSON.stringify(snapshot, null, 2))
  }

  fetch(id, version) {
    var path = this._dir + '/snapshots/' + id;
    var file = path + '/' + version;

    if (fs.existsSync(path) && !fs.existsSync(file)) {
      return this._clear(path).then(() => null);
    }

    return fs.readFileAsync(file)
      .then(content => JSON.parse(content))
      .catch(() => null)
  }

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }

  _clear(directory) {
    return fs.readdirAsync(directory)
      .then(files => Promise.all(files.map(file =>
        fs.unlinkAsync(path.join(directory, file)))))
  }
}

module.exports = {
  EventStore: FlatFileEventStore,
  SnapshotStore: FlatFileSnapshotStore
};