const os = require('os');
const fs = require('fs');

const chai = require('chai');
const promised = require('chai-as-promised');

chai.use(promised);
chai.should();

const karma = require('../../index');

chai.should();

describe('Flat file Event Bus', () => {
  let directory;

  beforeEach(() => {
    directory = os.tmpdir + '/karma3_' + Date.now() + Math.round(Math.random() * 1000);
  });

  it('stores Events in files', () => {
    return new FlatFileEventBus(directory)

      .publish([
        new karma.Event('One', 'foo', new Date('2011-12-13'), 'uno'),
        new karma.Event('Two', 'bar', new Date('2011-12-14'), 'dos')
      ])

      .then(bus => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 2,
            heads: {}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/events/1', (e, c) =>
          y(JSON.parse(c).should.eql({
            name: "One",
            payload: "foo",
            timestamp: "2011-12-13T00:00:00.000Z",
            traceId: "uno",
            sequence: 1
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/events/2', (e, c) =>
          y(JSON.parse(c).should.eql({
            name: "Two",
            payload: "bar",
            timestamp: "2011-12-14T00:00:00.000Z",
            traceId: "dos",
            sequence: 2
          })))
      }))
  });

  it('keeps Events in sequence', () => {
    return new FlatFileEventBus(directory)

      .publish([new karma.Event()])

      .then(bus =>
        bus.publish([new karma.Event('Two', 'bar', new Date('2011-12-14'), 'dos')]))

      .then(bus => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 2,
            heads: {}
          })))
      }))

      .then(() => new Promise(y => {
        fs.readFile(directory + '/events/2', 'utf8', (e, c) =>
          y(JSON.parse(c).should.eql({
            name: "Two",
            payload: "bar",
            timestamp: "2011-12-14T00:00:00.000Z",
            traceId: "dos",
            sequence: 2
          })))
      }))
  });

  it('protects Aggregate sequences', () => {
    var bus = new FlatFileEventBus(directory);

    return bus

      .publish([new karma.Event()], 'foo')

      .then(bus =>
        bus.publish([new karma.Event()], 'foo', 1))

      .then(bus =>
        bus.publish([new karma.Event()], 'foo', 1))

      .should.be.rejectedWith(Error, 'Head occupied.')

      .then(() => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 2,
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

    return new FlatFileEventBus(directory)

      .publish([new karma.Event()])

      .then(bus => new Promise(y => {
        bus.publish([new karma.Event('One', 'uno', new Date('2011-12-13'), 'uno')], 'foo', 0);

        setTimeout(() =>
          bus.publish([new karma.Event('Two', 'dos', new Date('2011-12-14'), 'dos')], 'bar', 0)
            .then(y), 0)
      }))

      .then(bus => bus.close())

      .then(() => new Promise(y => {
        fs.readFile(directory + '/write', (e, c) =>
          y(JSON.parse(c).should.eql({
            sequence: 3,
            heads: {foo: 2, bar: 3}
          })))
      }))

      .then(() => fs.writeFile = _writeFile)
  });

  it('reads Events from files', () => {
    let events = [];
    let bus = new FlatFileEventBus(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/events/3', JSON.stringify({
          name: "Three",
          sequence: 3
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/10', JSON.stringify({
          name: "Ten",
          sequence: 10
        }), y)
      }),
    ])

      .then(() => bus.subscribe(e => events.push(e)))

      .then(() => bus.close())

      .then(() => events.should.eql([
        {
          name: "Three",
          sequence: 3
        }, {
          name: "Ten",
          sequence: 10
        }
      ]))
  });

  it('filters Events by name', () => {
    let events = [];
    let bus = new FlatFileEventBus(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/events/1', JSON.stringify({
          name: "One",
          sequence: 11
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/2', JSON.stringify({
          name: "Two",
          sequence: 12
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/3', JSON.stringify({
          name: "Three",
          sequence: 13
        }), y)
      }),
    ])

      .then(() => bus.subscribe(e => events.push(e),
        bus.filter().nameIsIn(['One', 'Three'])))

      .then(() => bus.close())

      .then(() => events.should.eql([
        {
          name: "One",
          sequence: 11
        }, {
          name: "Three",
          sequence: 13
        }
      ]))
  });

  it('filters Events by sequence', () => {
    let events = [];
    let bus = new FlatFileEventBus(directory);

    return Promise.all([
      new Promise(y => {
        fs.writeFile(directory + '/events/21', JSON.stringify({
          name: "One",
          sequence: 11
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/23', JSON.stringify({
          name: "Two",
          sequence: 12
        }), y)
      }),
      new Promise(y => {
        fs.writeFile(directory + '/events/42', JSON.stringify({
          name: "Three",
          sequence: 13
        }), y)
      }),
    ])

      .then(() => bus.subscribe(e => events.push(e),
        bus.filter().after(11)))

      .then(() => bus.close())

      .then(() => events.should.eql([
        {
          name: "Two",
          sequence: 12
        }, {
          name: "Three",
          sequence: 13
        }
      ]))
  });

  it('notifies subscribers about published Events', () => {
    let events = [];
    let bus = new FlatFileEventBus(directory);

    return bus

      .subscribe(e => events.push(e))

      .then(() => new Promise(y => {
        fs.writeFile(directory + '/events/42', JSON.stringify({
          name: "One",
          sequence: 11
        }), y)
      }))

      .then(() => new Promise(y => setTimeout(y, 10)))

      .then(() => bus.close())

      .then(() => events.should.eql([{
        name: "One",
        sequence: 11
      }]))
  });
});

const lockFile = require('lockfile');
const chokidar = require('chokidar');

class FlatFileEventBus extends karma.EventBus {
  constructor(baseDir) {
    super();
    this._dir = baseDir;

    FlatFileEventBus._mkdir(baseDir);
    FlatFileEventBus._mkdir(baseDir + '/events');

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
    return new FlatFileEventFilter()
  }

  static _mkdir(dir) {
    try {
      fs.mkdirSync(dir)
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
}

class FlatFileEventFilter extends karma.EventFilter {
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