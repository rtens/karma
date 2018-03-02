const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');
const should = chai.should();

chai.use(promised);

const karma = require('../../src/karma');
const flatFile = require('../../src/persistence/flat-file');

describe.skip('Flat file Snapshot store', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Snapshots in files', () => {
    return new flatFile.SnapshotStore('Test', directory)

      .store({a:'foo'}, 'v1', new karma.Snapshot(42, 'bar'))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/snapshots/foo/v1', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 42,
            state: 'bar'
          })))
      }))
  });

  it('fetches Snapshots from files', () => {
    return new Promise(y => {
      fs.mkdirSync(directory);
      fs.mkdirSync(directory + '/Test');
      fs.mkdirSync(directory + '/Test/snapshots');
      fs.mkdirSync(directory + '/Test/snapshots/foo');
      fs.writeFile(directory + '/Test/snapshots/foo/v1', JSON.stringify({
        sequence: 42,
        state: 'bar'
      }), y)
    })

      .then(() => new flatFile.SnapshotStore('Test', directory)

        .fetch({a:'foo'}, 'v1'))

      .then(snapshot => snapshot.should.eql(new karma.Snapshot(42, 'bar')))
  });

  it('returns null if Snapshot does not exist', () => {
    return new flatFile.SnapshotStore('Test', directory)

      .fetch({a:'foo'}, 'v1')

      .then(snapshot => should.not.exist(snapshot))
  });

  it('return null and deletes existing Snapshots if the version does not match', () => {
    return new Promise(y => {
      fs.mkdirSync(directory);
      fs.mkdirSync(directory + '/Test');
      fs.mkdirSync(directory + '/Test/snapshots');
      fs.mkdirSync(directory + '/Test/snapshots/foo');
      fs.writeFile(directory + '/Test/snapshots/foo/v1', 'old version', y)
    })

      .then(() => new flatFile.SnapshotStore('Test', directory)

        .fetch({a:'foo'}, 'v2'))

      .then(snapshot => should.not.exist(snapshot))

      .then(() => fs.existsSync(directory + '/Test/snapshots/foo/v1').should.be.false)
  });
});