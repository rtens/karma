if (!process.env.FLAT_FILE_TEST_DIR)
  return console.log('Set $FLAT_FILE_TEST_DIR to test FlatFileEventStore');

const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const Promise = require("bluebird");
Promise.promisifyAll(fs);

const karma = require('../../../src/karma');
const flatFile = require('../../../src/persistence/flat-file');

describe('Flat file Event Store', () => {
  let directory;

  beforeEach(() => {
    directory = process.env.FLAT_FILE_TEST_DIR + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Records in files', () => {
    return new flatFile.EventStore(directory, 'Test')

      .record([
        new karma.Event('One', 'foo', new Date('2011-12-13')),
        new karma.Event('Two', 'bar', new Date('2011-12-14'))
      ], 'one', undefined, 'trace', new Date('2011-12-11T14:15:16.000Z'))

      .then(() => fs.readFileAsync(directory + '/Test/records/one.1').then(JSON.parse)
        .then(c => c.should.eql({
          event: {
            name: 'One',
            payload: 'foo',
            time: '2011-12-13T00:00:00.000Z'
          },
          streamId: 'one',
          sequence: 1,
          time: '2011-12-11T14:15:16.000Z',
          traceId: 'trace'
        })))

      .then(() => fs.readFileAsync(directory + '/Test/records/one.2').then(JSON.parse)
        .then(c => c.should.eql({
          event: {
            name: "Two",
            payload: "bar",
            time: "2011-12-14T00:00:00.000Z"
          },
          streamId: 'one',
          sequence: 2,
          time: '2011-12-11T14:15:16.000Z',
          traceId: 'trace'
        })))

      .then(() => fs.readFileAsync(directory + '/Test/one.write').then(JSON.parse)
        .then(c => c.should.eql({
          sequence: 2
        })))
  });

  it('rejects out-of-sequence Records', () => {
    let store = new flatFile.EventStore(directory, 'Test');
    return Promise.resolve()

      .then(() => fs.writeFileAsync(directory + '/Test/one.write', JSON.stringify({
        sequence: 42
      })))

      .then(() => store.record([new karma.Event()], 'one', 41))

      .should.be.rejectedWith(Error, 'Out of sequence')
  });

  it('avoids gaps in sequence', () => {
    let store = new flatFile.EventStore(directory, 'Test');
    return Promise.resolve()

      .then(() => fs.writeFileAsync(directory + '/Test/one.write', JSON.stringify({
        sequence: 42
      })))

      .then(() => store.record([new karma.Event()], 'one', 43))

      .should.be.rejectedWith(Error, 'Out of sequence')
  });

  it('avoids write conflicts', () => {
    let _writeFile = fs.writeFile;
    fs.writeFile = (f, c, cb) => {
      setTimeout(() => _writeFile(f, c, cb), 20);
      fs.writeFile = _writeFile;
    };

    return Promise.resolve(new flatFile.EventStore(directory, 'Test'))

      .then(store => new Promise((y, n) => {
        store.record([new karma.Event('One', 'uno')], 'foo');
        setTimeout(() => store.record([new karma.Event('Two', 'dos')], 'foo').then(y).catch(n), 10)
      }))

      .should.be.rejectedWith('Out of sequence')
  });

  it('allows concurrent writing to different streams', () => {
    let _writeFile = fs.writeFile;
    fs.writeFile = (f, c, cb) => {
      setTimeout(() => _writeFile(f, c, cb), 20);
      fs.writeFile = _writeFile;
    };

    return Promise.resolve(new flatFile.EventStore(directory, 'Test'))

      .then(store => new Promise((y, n) => {
        store.record([new karma.Event('One', 'uno')], 'foo');
        setTimeout(() => store.record([new karma.Event('Two', 'dos')], 'bar').then(y).catch(n), 10)
      }))

      .should.not.be.rejected
  });

  it('unlocks after conflict', () => {
    var store = new flatFile.EventStore(directory, 'Test');

    return store

      .record([new karma.Event()], 'foo', 42)

      .should.be.rejected

      .then(() => store.record([new karma.Event()], 'foo'))

      .should.not.be.rejected
  });
})
;