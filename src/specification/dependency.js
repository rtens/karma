const expect = require('chai').expect;
const specification = require('.');

class ValueDependencyContext extends specification.Context {
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  configure(example) {
    let object = example.dependencies;
    let keys = this.key.split('.');

    this.putDependency(example, object, keys, []);
  }

  putDependency(example, object, keys, myKeys) {
    let key = keys.shift();
    myKeys = [...myKeys, key];

    if (!key.endsWith('()')) {
      object[key] = this.dependency(example, keys, myKeys);
      return object;
    }

    let stub = new StubDependencyContext(myKeys.join('.'))
      .returning(this.dependency(example, keys, myKeys));

    example.stubs[stub.key] = stub;
    object[key.substr(0, key.length - 2)] = stub.value;
    return object;
  }

  dependency(example, keys, myKeys) {
    if (!keys.length) return this.value;
    return this.putDependency(example, {}, keys, myKeys);
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

module.exports = {
  ValueDependencyContext,
  StubDependencyContext,
  InvocationsExpectation,
  NoInvocationsExpectation
};