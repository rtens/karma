const expect = require('./expectation');

class Result {
  constructor(example, promise) {
    this.example = example;
    this.promise = promise;
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
        resolve()
      } catch (err) {
        reject(err)
      }
    }
  }
}

class RequestResult extends Result {
  constructor(example, response) {
    super(example, response.then(res => this.response = res));
  }

  finalAssertion() {
    expect.NoLoggedError().assert(this);
  }
}

class ReactionResult extends Result {

  finalAssertion() {
    expect.NoLoggedError().assert(this);
    this.example.metaStore.recorded
      .forEach(r => r.events
        .filter(e => e.name == '__reaction-failed')
        .forEach(e => {
          const error = new Error('Reaction failed: ' + e.payload.record.event.name);
          error.stack = e.payload.error;
          throw error
        }))
  }
}

module.exports = {
  Result,
  RequestResult,
  ReactionResult
};