const fs = require('fs');
const path = require('path');
const lockFile = require('lockfile');
const chokidar = require('chokidar');
const Promise = require("bluebird");
const queue = require('queue');

const karma = require('../karma');

Promise.promisifyAll(fs);
Promise.promisifyAll(lockFile);

function _mkdir(dir) {
  try {
    fs.mkdirSync(dir)
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
  }
}

class FlatFileEventStore extends karma.EventStore {
  constructor(baseDir, moduleName) {
    super();

    this._paths = {
      base: baseDir,
      module: [baseDir, moduleName].join('/'),
      records: [baseDir, moduleName, 'records'].join('/'),
      write: streamId => [baseDir, moduleName, streamId + '.write'].join('/'),
      lock: streamId => [baseDir, moduleName, streamId + '.lock'].join('/'),
      record: (streamId, sequence) => [baseDir, moduleName, 'records', streamId + '.' + sequence].join('/'),
    };

    _mkdir(this._paths.base);
    _mkdir(this._paths.module);
    _mkdir(this._paths.records);
  }

  record(events, streamId, onSequence, traceId) {
    onSequence = onSequence || 0;

    return Promise.resolve()
      .then(() => this._acquireLock(streamId))
      .then(() => this._guardSequence(streamId, onSequence))
      .then(() => this._writeRecords(events, streamId, onSequence, traceId))
      .then(() => this._writeWriteFile(streamId, onSequence + events.length))
      .then(() => this._releaseLock(streamId))
      .catch(e => this._releaseLock(streamId).then(() => Promise.reject(e)))
      .then(() => this)
  }

  _acquireLock(streamId) {
    return lockFile.lockAsync(this._paths.lock(streamId), {wait: 100, pollPeriod: 10})
      .catch(e => Promise.reject(new Error('Write locked')))
  }

  _releaseLock(streamId) {
    return lockFile.unlockAsync(this._paths.lock(streamId))
  }

  _guardSequence(streamId, expectedSequence) {
    return fs.readFileAsync(this._paths.write(streamId)).then(JSON.parse)
      .catch(() => ({sequence: 0}))
      .then(({sequence}) => sequence != expectedSequence
        ? Promise.reject(new Error('Out of sequence'))
        : Promise.resolve())
  }

  _writeRecords(events, streamId, onSequence, traceId) {
    var files = events
      .map((event, i) => new karma.Record(event, streamId, onSequence + 1 + i, traceId))
      .map(record => ({
        path: this._paths.record(streamId, record.sequence),
        content: JSON.stringify(record, null, 2)
      }));

    return Promise.each(files, file => fs.writeFileAsync(file.path, file.content))
  }

  _writeWriteFile(streamId, sequence) {
    return fs.writeFileAsync(this._paths.write(streamId), JSON.stringify({sequence}, null, 2));
  }
}

class FlatFileEventLog extends karma.EventLog {
  constructor(baseDir, moduleName) {
    super();

    this._paths = {
      base: baseDir + '/' ,
      module: baseDir + '/' + moduleName + '/',
      records: baseDir + '/' + moduleName + '/records/'
    };

    _mkdir(this._paths.base);
    _mkdir(this._paths.module);
    _mkdir(this._paths.records);

    this._subscriptions = [];
    this._notificationQueue = queue({concurrency: 1, autostart: true});
  }

  subscribe(streamHeads, subscriber) {
    let subscription = {subscriber, active: true, heads: {}};

    return this._startWatching()

      .then(() => this._readStreams(streamHeads, subscription))

      .then(() => this._subscriptions.push(subscription))

      .then(() => ({
          cancel: () => {
            subscription.active = false;
            if (this._subscriptions.filter(s => s.active).length == 0) {
              return this._close();
            }
          }
        })
      )
  }

  _startWatching() {
    if (this._watcher) {
      return Promise.resolve();
    }

    return new Promise(y =>
      this._watcher = chokidar.watch(this._paths.records).on('ready', y))

      .then(() => this._watcher.on('add', (file) => this._notificationQueue.push(() =>
        this._notifySubscribers(file, this._subscriptions.filter(s => s.active)))))
  }

  _readStreams(streamHeads, subscription) {
    return Promise.resolve()

      .then(() => fs.readdirAsync(this._paths.records))

      .then(files => files.map(f => ({
        name: f,
        streamId: path.basename(f, path.extname(f)),
        sequence: parseInt(path.extname(f).substr(1))
      })))

      .then(files => files.sort((a, b) => a.sequence - b.sequence))

      .then(files => files.filter(f => !streamHeads[f.streamId] || f.sequence > streamHeads[f.streamId]))

      .then(files => files.map(file => this._paths.records + file.name))

      .then(paths => Promise.each(paths, path => this._notifySubscribers(path, [subscription])))
  }

  _notifySubscribers(path, subscriptions) {
    return fs.readFileAsync(path).then(JSON.parse)

      .then(record => ({
        ...record, event: new Proxy(record.event, {
          get: (target, name) => name == 'time' ? new Date(target[name]) : target[name]
        })
      }))

      .then(record => Promise.all(subscriptions.map(subscription => subscription.subscriber(record))));
  }

  _close() {
    if (this._notificationQueue.length == 0) {
      this._watcher.close();
      this._watcher = null;
      return Promise.resolve();
    }
    return new Promise(y => setTimeout(() => this._close().then(y)), 100)
  }
}

class FlatFileSnapshotStore extends karma.SnapshotStore {
  constructor(baseDir, moduleName) {
    super();

    this._dir = baseDir + '/' + moduleName + '/snapshots';

    _mkdir(baseDir);
    _mkdir(baseDir + '/' + moduleName);
    _mkdir(this._dir);
  }

  store(key, version, snapshot) {
    var path = this._dir + '/' + key;
    _mkdir(path);

    return fs.writeFileAsync(path + '/' + version, JSON.stringify(snapshot, null, 2))
  }

  fetch(key, version) {
    var path = this._dir + '/' + key;
    var file = path + '/' + version;

    if (fs.existsSync(path) && !fs.existsSync(file)) {
      return this._clear(path).then(() => Promise.reject());
    }

    return fs.readFileAsync(file)
      .then(content => JSON.parse(content))
  }

  _clear(directory) {
    return fs.readdirAsync(directory)
      .then(files => Promise.all(files.map(file =>
        fs.unlinkAsync(path.join(directory, file)))))
  }
}

class FlatFilePersistenceFactory extends karma.PersistenceFactory {
  constructor(path) {
    super();
    this._path = path;
  }

  eventLog(moduleName) {
    return new FlatFileEventLog(this._path, moduleName)
  }

  snapshotStore(moduleName) {
    return new FlatFileSnapshotStore(this._path, moduleName);
  }

  eventStore(moduleName) {
    return new FlatFileEventStore(this._path, moduleName);
  }
}

module.exports = {
  PersistenceFactory: FlatFilePersistenceFactory,
  EventLog: FlatFileEventLog,
  SnapshotStore: FlatFileSnapshotStore,
  EventStore: FlatFileEventStore
};