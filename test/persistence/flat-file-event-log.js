const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const Promise = require("bluebird");
Promise.promisifyAll(fs);

const karma = require('../../src/karma');
const flatFile = require('../../src/persistence/flat-file');

describe('Flat file Event Log', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('replays Records from files', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    return Promise.all([
      fs.writeFileAsync(directory + '/records/two.3', JSON.stringify({event: {name: 'Two'}})),
      fs.writeFileAsync(directory + '/records/one.10', JSON.stringify({event: {name: 'Three'}})),
      fs.writeFileAsync(directory + '/records/one.2', JSON.stringify({event: {name: 'One'}}))
    ])

      .then(() => log.subscribe({}, record => records.push(record.event.name)))

      .then(subscription => subscription.cancel('foo'))

      .then(() => records.should.eql(['One', 'Two', 'Three']))
  });

  it('inflates Event time', () => {
    let times = [];
    let log = new flatFile.EventLog(directory);

    return fs.writeFileAsync(directory + '/records/two.3', JSON.stringify({event: {time: '2011-12-13T14:15:16Z'}}))

      .then(() => log.subscribe({}, record => times.push(record.event.time.getTime())))

      .then(subscription => subscription.cancel('foo'))

      .then(() => times.should.eql([1323785716000]))
  });

  it('filters Records by sequence heads', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    return Promise.all([
      fs.writeFileAsync(directory + '/records/one.11', JSON.stringify({event: {name: 'Not'}})),
      fs.writeFileAsync(directory + '/records/one.12', JSON.stringify({event: {name: 'One'}})),
      fs.writeFileAsync(directory + '/records/two.13', JSON.stringify({event: {name: 'Not'}})),
      fs.writeFileAsync(directory + '/records/two.14', JSON.stringify({event: {name: 'Two'}}))
    ])

      .then(() => log.subscribe({one: 11, two: 13}, record => records.push(record.event.name)))

      .then(subscription => subscription.cancel('foo'))

      .then(() => records.should.eql(['One', 'Two']))
  });

  it('notifies about new Records', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    return Promise.resolve()

      .then(() => log.subscribe({}, record => records.push(record.event.name)))

      .then(subscription => Promise.resolve()

        .then(() => fs.writeFileAsync(directory + '/records/uno', JSON.stringify({event: {name: 'One'}})))

        .then(() => new Promise(y => setTimeout(y, 100)))

        .then(() => subscription.cancel())

        .then(() => records.should.eql(['One'])))
  });

  it('de-duplicates notifications', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    let subscription1, subscription2;
    return log

      .subscribe({}, record => records.push('foo ' + record.event.name))

      .then(s => subscription1 = s)

      .then(() => fs.writeFileAsync(directory + '/records/uno', JSON.stringify({
        event: {name: 'One'},
        streamId: 'foo',
        sequence: 21
      })))

      .then(() => new Promise(y => setTimeout(y, 10)))

      .then(() => log.subscribe({}, record => records.push('bar ' + record.event.name)))

      .then(s => subscription2 = s)

      .then(() => fs.writeFileAsync(directory + '/records/dos', JSON.stringify({
        event: {},
        streamId: 'foo',
        sequence: 21
      })))

      .then(() => console.log('written'))

      .then(() => subscription1.cancel('foo'))

      .then(() => subscription2.cancel('bar'))

      .then(() => records.should.eql(['foo One', 'bar One']))
  });

  it('resets de-duplication on cancellation', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    return fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}}))

      .then(() => log.subscribe({}, record => records.push('a ' + record.event.name)))

      .then(subscription => subscription.cancel('foo'))

      .then(() => log.subscribe({}, record => records.push('b ' + record.event.name)))

      .then(subscription => subscription.cancel('foo'))

      .then(() => records.should.eql(['a One', 'b One']))
  });

  it('keeps order of recorded Events', () => {
    let _readFile = fs.readFile;
    fs.readFile = (f, cb) => {
      setTimeout(() => _readFile(f, cb), 20);
      fs.readFile = _readFile
    };

    let records = [];
    let log = new flatFile.EventLog(directory);

    let subscription;
    return log

      .subscribe({}, record => records.push(record.event.name))

      .then(s => subscription = s)

      .then(() => fs.writeFileAsync(directory + '/records/one-1', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 10)))

      .then(() => fs.writeFileAsync(directory + '/records/one-2', JSON.stringify({event: {name: 'Two'}})))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => subscription.cancel())

      .then(() => records.should.eql(['One', 'Two']))
  });

  it('stops notifying when cancelled', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    return log

      .subscribe('foo', {}, record => records.push(record.event.name))

      .then(subscription => subscription.cancel('foo'))

      .then(() => fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 200)))

      .then(() => records.should.eql([]))
  });

  it('restarts notifying about Events', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    let subscription;
    return log

      .subscribe({}, record => records.push(record.event.name))

      .then(subscription => subscription.cancel('foo'))

      .then(() => log.subscribe({}, record => records.push(record.event.name)))

      .then(s => subscription = s)

      .then(() => fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 200)))

      .then(() => subscription.cancel('foo'))

      .then(() => records.should.eql(['One']))
  });
});