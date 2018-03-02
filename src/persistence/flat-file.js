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
  constructor(baseDir) {
    super();
    this._paths = {
      base: baseDir + '/',
      records: baseDir + '/records/',
      write: streamId => baseDir + '/' + streamId + '.write',
      lock: streamId => baseDir + '/' + streamId + '.lock',
    };

    _mkdir(baseDir);
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
      .catch(e => Promise.reject(new Error('Locked')))
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
        path: this._paths.records + streamId + '-' + record.sequence,
        content: JSON.stringify(record, null, 2)
      }));

    return Promise.each(files, file => fs.writeFileAsync(file.path, file.content))
  }

  _writeWriteFile(streamId, sequence) {
    return fs.writeFileAsync(this._paths.write(streamId), JSON.stringify({sequence}, null, 2));
  }
}

class FlatFileEventLog extends karma.EventLog {
  // constructor(domain, baseDir) {
  //   super();
  //   this._domain = domain;
  //   this._attached = {};
  //   this._notified = {};
  //   this._notificationQueue = queue({concurrency: 1, autostart: true});
  //
  //   this._paths = {base: baseDir};
  //   this._paths.domain = this._paths.base + '/' + domain;
  //   this._paths.write = this._paths.domain + '/write';
  //   this._paths.lock = this._paths.domain + '/write.lock';
  //   this._paths.records = this._paths.domain + '/records';
  //
  //   ['base', 'domain', 'records'].forEach(path => FlatFileEventStore._mkdir(this._paths[path]));
  //
  //   this._watcher = chokidar.watch(this._paths.records);
  //   this._watcher.on('add', (file) =>
  //     this._notificationQueue.push(() => this._notifyAllUnits(file)))
  // }
  //
  // _notifyAllUnits(file) {
  //   return Promise.all(Object.values(this._attached)
  //     .map(unit => this._notifyUnit(file, unit)))
  // }
  //
  // _notifyUnit(file, unit) {
  //   if (file in this._notified[unit.id]) {
  //     return Promise.resolve();
  //   }
  //   this._notified[unit.id][file] = true;
  //
  //   return fs.readFileAsync(file)
  //
  //     .then(content => JSON.parse(content))
  //
  //     .then(record => unit.apply(new karma.Message(record.event, this._domain, record.revision)));
  // }
  //
  // attach(aggregate) {
  //   this._notified[aggregate.id] = this._notified[aggregate.id] || {};
  //
  //   return fs.readdirAsync(this._paths.records)
  //
  //     .then(files => files.sort((a, b) => parseInt(a) - parseInt(b)))
  //
  //     .then(files => aggregate._head ? files.filter(f => parseInt(f) > aggregate._head) : files)
  //
  //     .then(files => Promise.each(files, file => this._notifyUnit(this._paths.records + '/' + file, aggregate), {concurrency: 1}))
  //
  //     .then(() => this._attached[aggregate.id] = aggregate)
  //
  //     .then(() => this)
  // }
  //
  // detach(aggreagte) {
  //   delete this._notified[aggreagte.id];
  //   delete this._attached[aggreagte.id];
  //   return Promise.resolve(this);
  // }
  //
  // close() {
  //   return new Promise(y => setTimeout(() => this._close(y), 100));
  // }
  //
  // _close(y) {
  //   if (this._notificationQueue.length == 0) {
  //     return y(this._watcher.close());
  //   }
  //   setTimeout(() => this._close(y), 100)
  // }
}

class FlatFileSnapshotStore extends karma.SnapshotStore {
  constructor(baseDir) {
    super();
    this._dir = baseDir + '/snapshots';

    FlatFileSnapshotStore._mkdir(baseDir);
    FlatFileSnapshotStore._mkdir(this._dir);
  }

  store(key, version, snapshot) {
    var path = this._dir + '/' + key;
    FlatFileSnapshotStore._mkdir(path);

    return fs.writeFileAsync(path + '/' + version, JSON.stringify(snapshot, null, 2))
  }

  fetch(key, version) {
    var path = this._dir + '/' + key;
    var file = path + '/' + version;

    if (fs.existsSync(path) && !fs.existsSync(file)) {
      return this._clear(path).then(() => null);
    }

    return fs.readFileAsync(file)
      .then(content => JSON.parse(content))
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
  EventLog: FlatFileEventLog,
  SnapshotStore: FlatFileSnapshotStore,
  EventStore: FlatFileEventStore
};