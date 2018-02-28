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
  constructor(domain, baseDir) {
    super();
    this._domain = domain;
    this._attached = {};
    this._notified = {};
    this._notificationQueue = queue({concurrency: 1, autostart: true});

    this._paths = {base: baseDir};
    this._paths.domain = this._paths.base + '/' + domain;
    this._paths.write = this._paths.domain + '/write';
    this._paths.lock = this._paths.domain + '/write.lock';
    this._paths.records = this._paths.domain + '/records';

    ['base', 'domain', 'records'].forEach(path => FlatFileEventStore._mkdir(this._paths[path]));

    this._watcher = chokidar.watch(this._paths.records);
    this._watcher.on('add', (file) =>
      this._notificationQueue.push(() => this._notifyAllUnits(file)))
  }

  _notifyAllUnits(file) {
    return Promise.all(Object.values(this._attached)
      .map(unit => this._notifyUnit(file, unit)))
  }

  _notifyUnit(file, unit) {
    if (file in this._notified[unit.id]) {
      return Promise.resolve();
    }
    this._notified[unit.id][file] = true;

    return fs.readFileAsync(file)

      .then(content => JSON.parse(content))

      .then(record => unit.apply(new karma.Message(record.event, this._domain, record.revision)));
  }

  record(events, aggregateId, onRevision, traceId) {
    return Promise.resolve()
      .then(() => this._acquireLock())
      .then(() => this._readWriteFile())
      .then(write => this._guardHeads(write, aggregateId, onRevision))
      .then(write => this._writeEvents(write, events, traceId))
      .then(write => this._writeWriteFile(write, events, aggregateId))
      .then(() => this._releaseLock())
      .catch(e => this._releaseLock().then(() => Promise.reject(e)))
      .then(() => this)
  }

  _acquireLock() {
    return lockFile.lockAsync(this._paths.lock, {wait: 100, pollPeriod: 10})
      .catch(e => Promise.reject(new Error('Locked')))
  }

  _releaseLock() {
    return lockFile.unlockAsync(this._paths.lock)
  }

  _readWriteFile() {
    return fs.readFileAsync(this._paths.write)
      .then(writeContent => JSON.parse(writeContent))
      .catch(() => ({revision: 0, heads: {}}))
  }

  _guardHeads(write, sequenceId, headSequence) {
    if (sequenceId && sequenceId in write.heads && write.heads[sequenceId] != headSequence) {
      throw new Error('Head occupied.');
    }
    return write;
  }

  _writeEvents(write, events, traceId) {
    var contents = events
      .map((event, i) => new karma.Record(event, write.revision + i + 1, traceId))
      .map(record => ({record: JSON.stringify(record, null, 2), revision: record.revision}));

    return Promise.each(contents, content => fs.writeFileAsync(this._paths.records + '/' + content.revision, content.record))
      .then(() => write)
  }

  _writeWriteFile(write, events, sequenceId) {
    write = {
      revision: write.revision + events.length,
      heads: !sequenceId
        ? write.heads
        : {...write.heads, [sequenceId]: write.revision + events.length}
    };

    return fs.writeFileAsync(this._paths.write, JSON.stringify(write, null, 2));
  }

  attach(aggregate) {
    this._notified[aggregate.id] = this._notified[aggregate.id] || {};

    return fs.readdirAsync(this._paths.records)

      .then(files => files.sort((a, b) => parseInt(a) - parseInt(b)))

      .then(files => aggregate._head ? files.filter(f => parseInt(f) > aggregate._head) : files)

      .then(files => Promise.each(files, file => this._notifyUnit(this._paths.records + '/' + file, aggregate), {concurrency: 1}))

      .then(() => this._attached[aggregate.id] = aggregate)

      .then(() => this)
  }

  detach(aggreagte) {
    delete this._notified[aggreagte.id];
    delete this._attached[aggreagte.id];
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

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
}

class FlatFileSnapshotStore extends karma.SnapshotStore {
  constructor(domain, baseDir) {
    super();
    this._dir = baseDir + '/' + domain + '/snapshots';

    FlatFileSnapshotStore._mkdir(baseDir);
    FlatFileSnapshotStore._mkdir(baseDir + '/' + domain);
    FlatFileSnapshotStore._mkdir(this._dir);
  }

  store(key, version, snapshot) {
    var path = this._dir + '/' + Object.values(key).join('-');
    FlatFileSnapshotStore._mkdir(path);

    return fs.writeFileAsync(path + '/' + version, JSON.stringify(snapshot, null, 2))
  }

  fetch(key, version) {
    var path = this._dir + '/' + Object.values(key).join('-');
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
  EventBus: FlatFileEventStore,
  SnapshotStore: FlatFileSnapshotStore
};