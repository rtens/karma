const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');

chai.use(promised);
chai.should();

const karma = require('../../src/karma');
const flatFile = require('../../src/persistence/flat-file');

chai.should();

describe.skip('Flat file Event Store', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Events in files', () => {
    return new flatFile.EventStore('Test', directory)

      .record([
        new karma.Event('One', 'foo', new Date('2011-12-13')),
        new karma.Event('Two', 'bar', new Date('2011-12-14'))
      ], 'one', null, 'trace')

      .then(store => store.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {one: 2}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/records/1', (e, c) =>
          y(JSON.parse(c).should.eql({
            event: {
              name: "One",
              payload: "foo",
              time: "2011-12-13T00:00:00.000Z"
            },
            revision: 1,
            traceId: "trace"
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/records/2', (e, c) =>
          y(JSON.parse(c).should.eql({
            event: {
              name: "Two",
              payload: "bar",
              time: "2011-12-14T00:00:00.000Z"
            },
            revision: 2,
            traceId: "trace"
          })))
      }))
  });

  it('keeps Events in sequence', () => {
    return new flatFile.EventStore('Test', directory)

      .record([
        new karma.Event()
      ])

      .then(store => store.record([
        new karma.Event('Two', 'bar', new Date('2011-12-14'))
      ]))

      .then(store => store.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/records/2', 'utf8', (e, c) =>
          y(JSON.parse(c).should.eql({
            event: {
              name: "Two",
              payload: "bar",
              time: "2011-12-14T00:00:00.000Z"
            },
            revision: 2
          })))
      }))
  });

  it('protects Aggregate head', () => {
    var store = new flatFile.EventStore('Test', directory);

    return store

      .record([
        new karma.Event()]
      )

      .then(store => store.record([
        new karma.Event()
      ], 'foo', 1))

      .then(store => store.record([
        new karma.Event()
      ], 'foo', 1))

      .should.be.rejectedWith(Error, 'Head occupied.')

      .then(() => store.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {foo: 2}
          })))
      }))
  });

  it('avoids write collisions', () => {
    let _writeFile = fs.writeFile;
    fs.writeFile = (f, c, cb) => {
      setTimeout(() => _writeFile(f, c, cb), 10);
      fs.writeFile = _writeFile;
    };

    return new flatFile.EventStore('Test', directory)

      .record([new karma.Event()])

      .then(store => new Promise(y => {
        store.record([new karma.Event('One', 'uno')], 'foo', 0);

        setTimeout(() =>
          store.record([new karma.Event('Two', 'dos')], 'bar', 0)
            .then(y), 0)
      }))

      .then(bus => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/Test/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 3,
            heads: {foo: 2, bar: 3}
          })))
      }))

      .then(() => fs.writeFile = _writeFile)
  });

  it('unlocks after collision', () => {
    var store = new flatFile.EventStore('Test', directory);

    return store

      .record([
        new karma.Event()
      ], 'foo')

      .then(record => record.record([
        new karma.Event()
      ], 'foo', 1))

      .then(store => store.publish([
        new karma.Event()
      ], 'foo', 1))

      .catch(() => null)

      .then(() => store.record([
        new karma.Event()
      ], 'foo', 2))

      .then(() => store.close())

      .should.not.be.rejected
  });

  it('reads Events from files', () => {
    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

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

  it('filters Records by revision', () => {
    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

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

  it('notifies about recorded Events', () => {
    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

    return store

      .attach({id: 'foo', apply: m => messages.push(m.event)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'one'}), y)
      }))

      .then(() => store.close())

      .then(() => messages.should.eql(['one']))
  });

  it('de-duplicates notifications', () => {
    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

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

  it('keeps order of recorded Events', () => {
    let _readFile = fs.readFile;
    fs.readFile = (f, cb) => {
      setTimeout(() => _readFile(f, cb), 100);
      fs.readFile = _readFile
    };

    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

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

  it('stops notifying about Events', () => {
    let records = [];
    let store = new flatFile.EventStore('Test', directory);

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

  it('resets de-duplication on detachment', () => {
    let messages = [];
    let store = new flatFile.EventStore('Test', directory);

    return new Promise(y => fs.writeFile(directory + '/Test/records/42', JSON.stringify({event: 'one'}), y))

      .then(() => store.attach({id: 'foo', apply: m => messages.push('a ' + m.event)}))

      .then(() => store.detach({id: 'foo'}))

      .then(() => store.attach({id: 'foo', apply: m => messages.push('b ' + m.event)}))

      .then(() => store.close())

      .then(() => messages.should.eql(['a one', 'b one']))
  });
});