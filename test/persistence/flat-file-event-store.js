const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');

chai.use(promised);
chai.should();

const karma = require('../../src/karma');
const flatFile = require('../../src/persistence/flat-file');

chai.should();

describe('Flat file Event Store', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Events in files', () => {
    return new flatFile.EventStore(directory)

      .record([
        new karma.Event('One', 'foo', new Date('2011-12-13')),
        new karma.Event('Two', 'bar', new Date('2011-12-14'))
      ], 'one', null, 'trace')

      .then(store => store.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {one: 2}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/events/1', (e, c) =>
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
        fs.readFile(directory + '/events/2', (e, c) =>
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
    return new flatFile.EventStore(directory)

      .record([
        new karma.Event()
      ])

      .then(store => store.record([
        new karma.Event('Two', 'bar', new Date('2011-12-14'))
      ]))

      .then(store => store.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/events/2', 'utf8', (e, c) =>
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
    var store = new flatFile.EventStore(directory);

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
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 2,
            heads: {foo: 2}
          })))
      }))
  });

  it('avoids write collisions', () => {
    let _writeFile = fs.writeFile;
    let wait = 10;
    fs.writeFile = (f, c, cb) => {
      setTimeout(() => _writeFile(f, c, cb), wait);
      wait = 0;
    };

    return new flatFile.EventStore(directory)

      .record([new karma.Event()])

      .then(store => new Promise(y => {
        store.record([new karma.Event('One', 'uno')], 'foo', 0);

        setTimeout(() =>
          store.record([new karma.Event('Two', 'dos')], 'bar', 0)
            .then(y), 0)
      }))

      .then(bus => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            revision: 3,
            heads: {foo: 2, bar: 3}
          })))
      }))

      .then(() => fs.writeFile = _writeFile)
  });

  it('unlocks after collision', () => {
    var store = new flatFile.EventStore(directory);

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
    let records = [];
    let store = new flatFile.EventStore(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/events/3', JSON.stringify({
          event: 'Three',
          revision: 3
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/10', JSON.stringify({
          event: 'Ten',
          revision: 10
        }), y)
      }),
    ])

      .then(() => store.attach({id: 'foo', apply: r => records.push(r)}))

      .then(() => store.close())

      .then(() => records.should.eql([
        {
          event: 'Three',
          revision: 3
        }, {
          event: 'Ten',
          revision: 10
        }
      ]))
  });

  it('filters Records by revision', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/events/11', JSON.stringify({
          event: "One",
          revision: 11
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/12', JSON.stringify({
          event: "Two",
          revision: 12
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/13', JSON.stringify({
          event: "Three",
          revision: 3
        }), y)
      }),
    ])

      .then(() => store.attach({id: 'foo', _head: 11, apply: r => records.push(r)}))

      .then(() => store.close())

      .then(() => records.should.eql([
        {
          event: "Two",
          revision: 12
        }, {
          event: "Three",
          revision: 3
        }
      ]))
  });

  it('notifies about recorded Events', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: r => records.push(r)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/events/42', JSON.stringify('one'), y)
      }))

      .then(() => store.close())

      .then(() => records.should.eql(['one']))
  });

  it('de-duplicates notifications', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: r => records.push('foo ' + r)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/events/42', JSON.stringify('one'), y)
      }))

      .then(() => new Promise(y => {
        setTimeout(() => fs.unlink(directory + '/events/42', y), 100)
      }))

      .then(() => store.attach({id: 'bar', apply: r => records.push('bar ' + r)}))

      .then(() => new Promise(y => {
        setTimeout(() => fs.writeFile(directory + '/events/42', JSON.stringify('two'), y), 100)
      }))

      .then(() => store.close())

      .then(() => records.should.eql(['foo one', 'bar two']))
  });

  it('keeps sequence of recorded Events', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: r => records.push(r)})

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/events/1', JSON.stringify('one'), y)
      }))

      .then(() => new Promise(y => {
        setTimeout(() => fs.writeFile(directory + '/events/2', JSON.stringify('two'), y), 100)
      }))

      .then(() => store.close())

      .then(() => records.should.eql(['one', 'two']))
  });

  it('stops notifying about Events', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return store

      .attach({id: 'foo', apply: r => records.push(r)})

      .then(() => store.detach({id: 'foo'}))

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/events/42', JSON.stringify({
          name: "One",
          revision: 11
        }), y)
      }))

      .then(() => store.close())

      .then(() => records.should.eql([]))
  });

  it('resets de-duplication on detachment', () => {
    let records = [];
    let store = new flatFile.EventStore(directory);

    return new Promise(y => fs.writeFile(directory + '/events/42', JSON.stringify('one'), y))

      .then(() => store.attach({id: 'foo', apply: r => records.push('a ' + r)}))

      .then(() => store.detach({id: 'foo'}))

      .then(() => store.attach({id: 'foo', apply: r => records.push('b ' + r)}))

      .then(() => store.close())

      .then(() => records.should.eql(['a one', 'b one']))
  });
});