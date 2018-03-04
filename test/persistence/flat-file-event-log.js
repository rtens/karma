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

      .then(() => log.replay({}, record => records.push(record.event.name)))

      .then(() => records.should.eql(['One', 'Two', 'Three']))
  });

  it('inflates Event time', () => {
    let times = [];
    let log = new flatFile.EventLog(directory);

    return fs.writeFileAsync(directory + '/records/two.3', JSON.stringify({event: {time: '2011-12-13T14:15:16Z'}}))

      .then(() => log.replay({}, record => times.push(record.event.time.getTime())))

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

      .then(() => log.replay({one: 11, two: 13}, record => records.push(record.event.name)))

      .then(() => records.should.eql(['One', 'Two']))
  });

  it('notifies about new Records', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    let subscription;
    return Promise.resolve()

      .then(() => subscription = log.subscribe(record => records.push(record.event.name)))

      .then(() => fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 100)))

      .then(() => subscription.cancel())

      .then(() => records.should.eql(['One']))
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
    return Promise.resolve(subscription = log.subscribe(record => records.push(record.event.name)))

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

    return Promise.resolve(log.subscribe(record => records.push(record.event.name)))

      .then(subscription => subscription.cancel('foo'))

      .then(() => fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 200)))

      .then(() => records.should.eql([]))
  });

  it('restarts notifying about Events', () => {
    let records = [];
    let log = new flatFile.EventLog(directory);

    let subscription;
    return Promise.resolve(subscription = log.subscribe(record => records.push(record.event.name)))

      .then(() => subscription.cancel('foo'))

      .then(() => subscription = log.subscribe(record => records.push(record.event.name)))

      .then(() => fs.writeFileAsync(directory + '/records/one-42', JSON.stringify({event: {name: 'One'}})))

      .then(() => new Promise(y => setTimeout(y, 200)))

      .then(() => subscription.cancel('foo'))

      .then(() => records.should.eql(['One']))
  });
});