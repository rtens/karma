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

  it.skip('reads Events from files', () => {
    let messages = [];
    let store = new flatFile.EventStore(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/Test/records/3', JSON.stringify({
          event: 'Three',
          revision: 3
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/Test/records/10', JSON.stringify({
          event: 'Ten',
          revision: 10
        }), y)
      }),
    ])

      .then(() => store.attach({id: 'foo', apply: m => messages.push(m)}))

      .then(() => store.close())

      .then(() => messages.should.eql([
        {
          event: 'Three',
          domain: 'Test',
          sequence: 3
        }, {
          event: 'Ten',
          domain: 'Test',
          sequence: 10
        }
      ]))
  });

  it.skip('filters Records by revision', () => {
    let messages = [];
    let store = new flatFile.EventStore(directory);

    return Promise.resolve()

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/11', JSON.stringify({
          event: "One",
          revision: 11
        }), y)
      }))

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/12', JSON.stringify({
          event: "Two",
          revision: 12
        }), y)
      }))

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/13', JSON.stringify({
          event: "Three",
          revision: 3
        }), y)
      }))

      .then(() => store.attach({id: 'foo', _head: 11, apply: m => messages.push(m)}))

      .then(() => store.close())

      .then(() => messages.should.eql([
        {
          event: "Two",
          domain: 'Test',
          sequence: 12
        }, {
          event: "Three",
          domain: 'Test',
          sequence: 3
        }
      ]))
  });

  it.skip('notifies about recorded Events', () => {
    let messages = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: m => messages.push(m.event)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'one'}), y)
      }))

      .then(() => store.close())

      .then(() => messages.should.eql(['one']))
  });

  it.skip('de-duplicates notifications', () => {
    let messages = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: m => messages.push('foo ' + m.event)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'one'}), y)
      }))

      .then(() => new Promise(y => {
        setTimeout(() => fs.unlink(directory + '/Test/records/42', y), 100)
      }))

      .then(() => store.attach({id: 'bar', apply: m => messages.push('bar ' + m.event)}))

      .then(() => new Promise(y => {
        setTimeout(() => fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'two'}), y), 100)
      }))

      .then(() => store.close())

      .then(() => messages.should.eql(['foo one', 'bar two']))
  });

  it.skip('keeps order of recorded Events', () => {
    let _readFile = fs.readFile;
    fs.readFile = (f, cb) => {
      setTimeout(() => _readFile(f, cb), 100);
      fs.readFile = _readFile
    };

    let messages = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: m => messages.push(m.event)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/1', JSON.stringify({event: 'one'}), y)
      }))

      .then(() => new Promise(y => {
        setTimeout(() => fs.writeFile(directory + '/Test/records/2', JSON.stringify({event: 'two'}), y), 10)
      }))

      .then(() => store.close())

      .then(() => messages.should.eql(['one', 'two']))
  });

  it.skip('stops notifying about Events', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: r => records.push(r)})

      .then(() => store.detach({id: 'foo'}))

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/42', JSON.stringify({
          name: "One",
          revision: 11
        }), y)
      }))

      .then(() => store.close())

      .then(() => records.should.eql([]))
  });

  it.skip('resets de-duplication on detachment', () => {
    let messages = [];
    let store = new flatFile.EventStore(directory);

    return new Promise(y => fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'one'}), y))

      .then(() => store.attach({id: 'foo', apply: m => messages.push('a ' + m.event)}))

      .then(() => store.detach({id: 'foo'}))

      .then(() => store.attach({id: 'foo', apply: m => messages.push('b ' + m.event)}))

      .then(() => store.close())

      .then(() => messages.should.eql(['a one', 'b one']))
  });

  it('inflates Event time');
});