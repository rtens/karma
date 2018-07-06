const expect = require('chai').expect;
const specification = require('.');

class ValueDependencyContext extends specification.Context {
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  configure(example) {
    this.buildDependency(example, example.dependencies, this.key.split('.'), []);
  }

  buildDependency(example, object, keysLeft, keysUp) {
    if (keysLeft.length == 1) {
      this.setValue(object, keysLeft.shift());
    } else {
      this.setObject(example, object, keysLeft, keysUp);
    }

    return object;
  }

  setValue(object, key) {
    object[key.endsWith('()') ? key.substr(0, key.length - 2) : key] = this.value;
  }

  setObject(example, object, keysLeft, keysUp) {
    let key = keysLeft.shift();
    keysUp = [...keysUp, key];

    if (key.endsWith('()')) {
      key = key.substr(0, key.length - 2);
      object[key] = this.buildStub(example, object[key] || {}, keysLeft, keysUp);
    } else {
      object[key] = this.buildDependency(example, object[key] || {}, keysLeft, keysUp);
    }
  }

  buildStub(example, object, keysLeft, keysUp) {
    let stub = new StubDependencyContext(keysUp.join('.'))
      .returning(this.buildDependency(example, object, keysLeft, keysUp));

    example.stubs[stub.key] = stub;
    return stub.value;
  }
}

class StubDependencyContext extends ValueDependencyContext {
  constructor(key) {
    super(key);

    this.invocations = [];
    this.callback = () => null;

    const stub = this;
    this.value = function () {
      stub.invocations.push([...arguments]);
      return stub.callback.apply(null, arguments);
    }
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
    this.callback = function () {
      return callback(this.invocations.length - 1).apply(null, arguments);
    }.bind(this);

    return this
  }

  configure(example) {
    example.stubs[stubKey(this.key)] = this;
    return super.configure(example)
  }
}

class InvocationsExpectation extends specification.Expectation {
  constructor(key) {
    super();
    this.key = key;
    this.invocations = [];
  }

  withArguments() {
    this.invocations.push([...arguments]);
    return this
  }

  assert(result) {
    const stub = result.example.stubs[stubKey(this.key)];

    //noinspection BadExpressionStatementJS
    expect(stub, `Stub [${this.key}] not found`).to.exist;

    //noinspection BadExpressionStatementJS
    expect(stub.invocations, `Missing invocations of [${this.key}]`).to.not.be.empty;
    this._assertArgumentCallbacks(stub.invocations);
    expect(stub.invocations).to.eql(this.invocations, `Unexpected invocations of [${this.key}]`);
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
  constructor(key) {
    super();
    this.key = key;
  }

  assert(result) {
    const stub = result.example.stubs[stubKey(this.key)];

    //noinspection BadExpressionStatementJS
    expect(stub, `Stub [${this.key}] not found`).to.exist;
    expect(stub.invocations).to.eql([], `Unexpected invocations of [${this.key}]`);
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

function stubKey(key) {
  return key + (key.endsWith('()') ? '' : '()')
}

module.exports = {
  ValueDependencyContext,
  StubDependencyContext,
  InvocationsExpectation,
  NoInvocationsExpectation,
  DelayedResultExpectation
};