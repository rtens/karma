const expect = require('chai').expect;

const unit = require('../unit');
const persistence = require('../persistence');
const domain = require('../domain');
const message = require('../message');
const fake = require('./fakes');

class Example {
  constructor(module) {
    this.module = module;

    this._setUpDate();
    this._setUpErrorLogging();
    this._setUpDependencies();
    this._setUpDomain();
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
    this.errors = [];
    console.error = message => this.errors.push(message);
  }

  _setUpDomain() {
    this.store = new fake.EventStore();
    this.log = new fake.EventLog();

    this.metaStore = new fake.EventStore();
    this.metaLog = new fake.EventLog();

    this.domain = new domain.Domain('Example',
      new unit.UnitStrategy(),
      {
        eventStore: () => this.store,
        eventLog: () => this.log,
        snapshotStore: () => new fake.SnapshotStore(),
      },
      {
        eventStore: () => this.metaStore,
        eventLog: () => this.metaLog,
        snapshotStore: () => new fake.SnapshotStore(),
      });
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
    this.handler = this.module(this.domain, this.dependencies);

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
    this.promise = promise
      .catch(err => err instanceof message.Rejection
        ? this.rejection = err
        : Promise.reject(err));
  }

  finalAssertion() {
  }

  then(expectation, reject) {
    let resolve = (typeof expectation != 'function')
      ? this._keepStack(expectation)
      : this._finishUp(expectation, reject);

    this.promise = this.promise.then(resolve, reject);
    return this
  }

  _keepStack(expectation) {
    let error = new Error();
    return () => {
      try {
        expectation.assert(this);
      } catch (err) {
        err.stack += error.stack;
        throw err;
      }
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
    }
  }
}

class Expectation {
  assert(result) {
  }
}

module.exports = {
  Example,
  Context,
  Action,
  Result,
  Expectation
};