const expect = require('./expectation');

class Result {
  constructor(example, promise) {
    this.promise = promise;
    this.example = example;
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
    return expect.NoError().assert(this);
  }
}

module.exports = {
  RequestResult
};