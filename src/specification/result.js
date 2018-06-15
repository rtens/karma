const expect = require('./expectation');

class Result {
  constructor(promise) {
    this.lastPromise = promise;
  }

  finalAssertion() {
  }

  then(expectation, reject) {
    let resolve = (typeof expectation != 'function')
      ? this._keepStack(expectation)
      : this._finishUp(expectation, reject);

    this.lastPromise = this.lastPromise.then(resolve, reject);
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
  constructor(response, errors) {
    super(response.then(res => this.response = res));
    this.errors = errors;
  }

  finalAssertion() {
    return expect.NoError().assert(this);
  }
}

module.exports = {
  RequestResult
};