const expect = require('chai').expect;
const specification = require('.');

class ValueDependencyContext extends specification.Context {
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  configure(example) {
    this.putDependency(example, example.dependencies, this.key.split('.'), []);
  }

  putDependency(example, object, keysLeft, keysUp) {
    let key = keysLeft.shift();
    keysUp = [...keysUp, key];

    if (key.endsWith('()')) {
      key = key.substr(0, key.length - 2);
      object[key] = this.buildStub(example, keysLeft, keysUp, object[key]);
    } else {
      object[key] = this.buildDependency(example, keysLeft, keysUp, object[key]);
    }

    return object;
  }

  buildStub(example, keys, myKeys, object) {
    let stub = new StubDependencyContext(myKeys.join('.'))
      .returning(this.buildDependency(example, keys, myKeys, object));

    example.stubs[stub.key] = stub;
    return stub.value;
  }

  buildDependency(example, keys, myKeys, object = {}) {
    if (!keys.length) return this.value;
    return this.putDependency(example, object, keys, myKeys);
  }
}

class StubDependencyContext extends ValueDependencyContext {
  constructor(key) {
    super(key, function () {
      stub.invocations.push([...arguments]);
      return stub.callback.apply(null, arguments);
    });
    this.invocations = [];
    this.callback = () => null;
    const stub = this;
  }

  returning(value) {
    this.callback = () => value;
    return this
  }

  calling(callback) {
    this.callback = callback;
    return this
  }

  callingIndexed(callback) {
    const stub = this;
    this.callback = function () {
      return callback(stub.invocations.length - 1).apply(null, arguments);
    };
    return this
  }

  configure(example) {
    example.stubs[this.key] = this;
    return super.configure(example)
  }
}

class InvocationsExpectation extends specification.Expectation {
  constructor(stubKey) {
    super();
    this.key = stubKey;
    this.invocations = [];
  }

  withArguments() {
    this.invocations.push([...arguments]);
    return this
  }

  assert(result) {
    let invocations = result.example.stubs[this.key].invocations;

    //noinspection BadExpressionStatementJS
    expect(invocations, `Missing invocations of [${this.key}]`).to.not.be.empty;
    this._assertArgumentCallbacks(invocations);
    expect(invocations).to.eql(this.invocations, `Unexpected invocations of [${this.key}]`);
  }

  _assertArgumentCallbacks(invocations) {
    this.invocations.forEach((invocation, i) =>
      invocation.forEach((argument, a) => {
        if (typeof argument == 'function') {
          try {
            argument(invocations[i][a]);
          } catch (err) {
            err.message = `Unexpected argument [${a}] in ` +
              `invocation [${i}] of [${this.key}]: ` + err.message;
            throw err;
          }
          this.invocations[i][a] = '*CALLBACK*';
          invocations[i][a] = '*CALLBACK*';
        }
      }));
  }
}

class NoInvocationsExpectation extends specification.Expectation {
  constructor(stubKey) {
    super();
    this.key = stubKey;
  }

  assert(result) {
    let invocations = result.example.stubs[this.key].invocations;
    expect(invocations).to.eql([], `Unexpected invocations of [${this.key}]`);
  }
}

class DelayedResultExpectation extends specification.Expectation {
  constructor(waitMillis = 0) {
    super();
    this.waitMillis = waitMillis;
  }

  assert() {
    return new Promise(y => setTimeout(y, this.waitMillis))
  }
}

module.exports = {
  ValueDependencyContext,
  StubDependencyContext,
  InvocationsExpectation,
  NoInvocationsExpectation,
  DelayedResultExpectation
};