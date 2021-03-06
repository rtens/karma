const expect = require('chai').expect;

const unit = require('../unit');
const persistence = require('../persistence');
const domain = require('../domain');
const message = require('../message');
const fake = require('./fakes');

const _setTimeout = setTimeout;

class Example {
  constructor(Module) {
    this.Module = Module;
    this.domainName = 'Example';

    setTimeout = fn => fn();
    setTimeout.forReal = _setTimeout;

    this._setUpDate();
    this._setUpErrorLogging();
    this._setUpDependencies();
    this._setUpPersistence();
  }

  _setUpDate() {
    this.time = '2011-12-13T14:15:16.789Z';
    const example = this;

    const _Date = Date;
    Date = function (time) {
      return new _Date(time || example.time);
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;
  }

  _setUpErrorLogging() {
    let errors = this.errors = [];

    this.logger = new class extends fake.Logger {
      error(tag, traceId, error) {
        super.error(tag, traceId, error);
        errors.push(error);
      }
    }();
  }

  _setUpPersistence() {
    this.log = new fake.EventLog();
    this.store = new fake.EventStore(record => {
      record = {...record, time: 0};
      this.log.records.push(record);
      return this.log.publish(record);
    });

    this.metaStore = new fake.EventStore();
    this.metaLog = new fake.EventLog();

    this.strategy = new class extends unit.UnitStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit) {
        unit.takeSnapshot()
      }
    }
  }

  _setUpDependencies() {
    this.dependencies = {};
    this.stubs = {};
  }

  given(context) {
    if (!Array.isArray(context)) context = [context];
    context.forEach(c => c.configure(this));
    return this
  }

  when(action) {
    this.module = new this.Module(
      this.domainName,
      this.log,
      new fake.SnapshotStore(),
      this.store,
      this.metaLog,
      new fake.SnapshotStore(),
      this.metaStore,
      this.strategy,
      this.logger,
      this.dependencies);

    return action.perform(this)
  }
}

class Context {
  configure(example) {
  }
}

class Action {
  perform(example) {
  }
}

class Result {
  constructor(example, promise) {
    this.example = example;
    this.promise = Promise.race([

      new Promise((y, n) => setTimeout.forReal(() =>
        n(new Error('No Response')), 10)),

      promise
        .catch(err => err instanceof message.Rejection
          ? this.rejection = err
          : Promise.reject(err))
    ]);
  }

  finalAssertion() {
  }

  then(expectation, reject) {
    let error = new Error();

    let resolve = (typeof expectation != 'function')
      ? () => this._assertKeepingStack(expectation, error)
      : this._finishUp(expectation, reject);

    this.promise = this.promise.then(resolve, reject);
    return this
  }

  _assertKeepingStack(expectation, error) {
    try {
      return expectation.assert(this)
    } catch (err) {
      err.stack += error.stack;
      throw err;
    }
  }

  _finishUp(resolve, reject) {
    return () => {
      try {
        this.finalAssertion();

        //noinspection BadExpressionStatementJS
        expect(this.rejection, 'Unexpected Rejection').not.to.exist;

        resolve()
      } catch (err) {
        reject(err)
      }

      setTimeout = _setTimeout;
    }
  }
}

class Expectation {
  assert(result) {
  }
}

class TimeContext extends Context {
  constructor(timeString) {
    super();
    this.time = timeString;
  }

  configure(example) {
    example.time = this.time;
  }
}

module.exports = {
  Example,
  Context,
  Action,
  Result,
  Expectation,
  TimeContext
};