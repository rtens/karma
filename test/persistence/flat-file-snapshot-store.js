const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');
const should = chai.should();

chai.use(promised);

const karma = require('../../index');

describe('Flat file Snapshot store', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Snapshots in files', () => {
    return new FlatFileSnapshotStore(directory)

      .store('foo', 'v1', new karma.Snapshot(42, 'bar'))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/snapshots/foo/v1', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 42,
            state: 'bar'
          })))
      }))
  });

  it('fetches Snapshots from files', () => {
    return new Promise(y => {
      fs.mkdirSync(directory);
      fs.mkdirSync(directory + '/snapshots');
      fs.mkdirSync(directory + '/snapshots/foo');
      fs.writeFile(directory + '/snapshots/foo/v1', JSON.stringify({
        sequence: 42,
        state: 'bar'
      }), y)
    })

      .then(() => new FlatFileSnapshotStore(directory)

        .fetch('foo', 'v1'))

      .then(snapshot => snapshot.should.eql({
        sequence: 42,
        state: 'bar'
      }))
  });

  it('returns null if Snapshot does not exist', () => {
    return new FlatFileSnapshotStore(directory)

      .fetch('foo', 'v1')

      .then(snapshot => should.not.exist(snapshot))
  });

  it('return null and deletes existing Snapshots if the version does not match', () => {
    return new Promise(y => {
      fs.mkdirSync(directory);
      fs.mkdirSync(directory + '/snapshots');
      fs.mkdirSync(directory + '/snapshots/foo');
      fs.writeFile(directory + '/snapshots/foo/v1', 'old version', y)
    })

      .then(() => new FlatFileSnapshotStore(directory)

        .fetch('foo', 'v2'))

      .then(snapshot => should.not.exist(snapshot))

      .then(() => fs.existsSync(directory + '/snapshots/foo/v1').should.be.false)
  });
});

const path = require('path');

class FlatFileSnapshotStore extends karma.SnapshotStore {
  constructor(baseDir) {
    super();
    this._dir = baseDir;

    FlatFileSnapshotStore._mkdir(baseDir);
    FlatFileSnapshotStore._mkdir(baseDir + '/snapshots');
  }

  store(id, version, snapshot) {
    return new Promise(y => {
      var path = this._dir + '/snapshots/' + id;
      FlatFileSnapshotStore._mkdir(path);
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