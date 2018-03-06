const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.should();
chai.use(promised);

const karma = require('../../src/karma');
const flatFile = require('../../src/persistence/flat-file');

describe('Flat file Snapshot store', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Snapshots in files', () => {
    return new flatFile.SnapshotStore(directory)

      .store('foo', 'v1', new karma.Snapshot({foo: 42}, 'bar'))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/snapshots/foo/v1', (e, c) =>
          y(JSON.parse(c).should.eql({
            heads: {foo: 42},
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
        heads: {foo: 42},
        state: 'bar'
      }), y)
    })

      .then(() => new flatFile.SnapshotStore(directory)

        .fetch('foo', 'v1'))

      .then(snapshot => snapshot.should.eql(new karma.Snapshot({foo: 42}, 'bar')))
  });

  it('fails if Snapshot does not exist', () => {
    return new flatFile.SnapshotStore(directory)

      .fetch('foo', 'v1')

      .should.be.rejected
  });

  it('fails and deletes existing Snapshots if the version does not match', () => {
    return new Promise(y => {
      fs.mkdirSync(directory);
      fs.mkdirSync(directory + '/snapshots');
      fs.mkdirSync(directory + '/snapshots/foo');
      fs.writeFile(directory + '/snapshots/foo/v1', 'old version', y)
    })

      .then(() => new flatFile.SnapshotStore(directory)

        .fetch('foo', 'v2'))

      .should.be.rejected

      .then(() => fs.existsSync(directory + '/snapshots/foo/v1').should.be.false)
  });
});