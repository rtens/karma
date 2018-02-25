const fs = require('fs');
const path = require('path');
const lockFile = require('lockfile');
const chokidar = require('chokidar');

const karma = require('../index');

class EventBus extends karma.EventBus {
  constructor(baseDir) {
    super();
    this._dir = baseDir;

    EventBus._mkdir(baseDir);
    EventBus._mkdir(baseDir + '/events');

    this._watcher = chokidar.watch(baseDir + '/events', {ignored: /^\./, persistent: true});
  }

  publish(events, sequenceId, headSequence) {
    return Promise.resolve()

      .then(() => new Promise((y, n) => {
        var opts = {wait: 100, pollPeriod: 10};
        lockFile.lock(this._dir + '/write.lock', opts, e => e ? n(new Error('Locked')) : y())
      }))

      .then(() => new Promise(y => {
        fs.readFile(this._dir + '/write', (err, c) => (err || !c) ? y({sequence: 0, heads: {}}) : y(JSON.parse(c)))
      }))

      .then(write => new Promise((y, n) => {
        if (sequenceId && sequenceId in write.heads && write.heads[sequenceId] != headSequence) {
          return n(new Error('Head occupied.'));
        }
        return y(write);
      }))

      .then(write => Promise.all(
        events.map(event => new Promise((y, n) => {
          write.sequence++;
          var content = JSON.stringify(event.withSequence(write.sequence), null, 2);
          fs.writeFile(this._dir + '/events/' + write.sequence, content, (err) => err ? n(err) : y())
        })))
        .then(() => write))

      .then(write => new Promise((y, n) => {
        if (sequenceId) {
          write.heads[sequenceId] = write.sequence;
        }
        var content = JSON.stringify(write, null, 2);
        fs.writeFile(this._dir + '/write', content, (err) => err ? n(err) : y())
      }))

      .then(() => new Promise((y, n) => {
        lockFile.unlock(this._dir + '/write.lock', e => e ? n(e) : y())
      }))

      .then(() => this)
  }

  subscribe(subscriber, filter) {
    return new Promise((y, n) => {
      fs.readdir(this._dir + '/events', (err, files) => {
        if (err) return n(err);

        files.sort((a, b) => parseInt(a) - parseInt(b));

        Promise.all(files.map(f => this._dir + '/events/' + f)
          .map(f => new Promise((y, n) => {
            fs.readFile(f, (err, c) => {
              if (err) return n(err);
              y(JSON.parse(c))
            })
          })))
          .then(y);
      })
    })

      .then(files => files
        .filter(event => !filter || filter.matches(event))
        .forEach(subscriber))

      .then(() => this._watcher.on('add', (path) => {
          fs.readFile(path, (err, c) => {
            if (err) return n(err);
            let event = JSON.parse(c);

            if (event => !filter || filter.matches(event)) {
              subscriber(event)
            }
          })
        }
      ))
      ;
  }

  close() {
    this._watcher.close();
  }

  filter() {
    return new EventFilter()
  }

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
}

class EventFilter extends karma.EventFilter {
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
      && (!this._after || event.sequence > this._after);
  }
}

class SnapshotStore extends karma.SnapshotStore {
  constructor(baseDir) {
    super();
    this._dir = baseDir;

    SnapshotStore._mkdir(baseDir);
    SnapshotStore._mkdir(baseDir + '/snapshots');
  }

  store(id, version, snapshot) {
    return new Promise(y => {
      var path = this._dir + '/snapshots/' + id;
      SnapshotStore._mkdir(path);
      fs.writeFile(path + '/' + version, JSON.stringify(snapshot, null, 2), y)
    })
  }

  fetch(id, version) {
    return new Promise((y, n) => {
      var path = this._dir + '/snapshots/' + id;
      var file = path + '/' + version;

      if (fs.existsSync(path) && !fs.existsSync(file)) {
        return this._clear(path).then(y).catch(n);
      }

      fs.readFile(file, (e, c) =>
        (e || !c) ? y(null) : y(JSON.parse(c)))
    })
  }

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }

  _clear(directory) {
    return new Promise((y, n) => {
      fs.readdir(directory, (err, files) => {
        if (err) return n(err);

        for (const file of files) {
          fs.unlink(path.join(directory, file), err => {
            if (err) n(err);
          });
        }

        y()
      })
    })
  }
}

module.exports = {EventBus, SnapshotStore};