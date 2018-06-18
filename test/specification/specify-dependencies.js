const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const {the, Example, expect} = require('../../spec');
const result = require('../../src/specification/result');

describe('Specifying dependencies', () => {

  it('uses injected values', () => {
    let injected = null;

    new Example((domain, server, dependencies) =>
      injected = dependencies.foo)

      .given(the.Value('foo', 'bar'))

      .when(anyAction);

    injected.should.equal('bar');
  });

  it('uses injected stub', () => {
    let stubbed = null;

    new Example((domain, server, dependencies) =>
      stubbed = dependencies.foo())

      .given(the.Stub('foo').returning('bar'))

      .when(anyAction);

    stubbed.should.equal('bar');
  });

  it('uses dynamic stub', () => {
    let stubbed = null;

    new Example((domain, server, dependencies) =>
      stubbed = dependencies.foo('foo', 'bar'))

      .given(the.Stub('foo')
        .calling((a, b) => a + b))

      .when(anyAction);

    stubbed.should.equal('foobar');
  });

  it('uses dynamic stub with indexed callback', () => {
    let stubbed = [];

    new Example((domain, server, dependencies) => {
      stubbed.push(dependencies.foo(3, 4));
      stubbed.push(dependencies.foo(5, 6));
      stubbed.push(dependencies.foo(7, 8));
    })

      .given(the.Stub('foo')
        .callingIndexed(i => (a, b) => a + b * i))

      .when(anyAction);

    stubbed.should.eql([3, 11, 23]);
  });

  it('uses injected values in objects', () => {
    let injected = null;

    new Example((domain, server, dependencies) =>
      injected = dependencies.foo.bar.baz)

      .given(the.Value('foo.bar.baz', 'ban'))

      .when(anyAction);

    injected.should.equal('ban');
  });

  it('uses injected values returned by function', () => {
    let injected = null;

    new Example((domain, server, dependencies) =>
      injected = dependencies.foo().bar().baz)

      .given(the.Value('foo().bar().baz', 'ban'))

      .when(anyAction);

    injected.should.equal('ban');
  });

  it('asserts expected invocations of static stubs', () => {
    return new Example((domain, server, dependencies) => {
      dependencies.foo('a').bar('one', 'uno');
      dependencies.foo('b').bar('two', 'dos');
    })

      .given(the.Stub('foo().bar'))

      .when(anyAction)

      .then(expect.Invocations('foo().bar')
        .withArguments('one', 'uno')
        .withArguments('two', 'dos'))

      .then(expect.Invocations('foo()')
        .withArguments('a')
        .withArguments('b'))
  });

  it('asserts expected invocations of dynamic stub', () => {
    return new Example((domain, server, dependencies) => {
      dependencies.foo('one');
    })

      .given(the.Stub('foo').calling(() => 'bar'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('one'))
  });

  it('fails if expected invocation is missing', () => {
    return new Example(() => null)

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo'))

      .promise.should.be.rejectedWith('Missing invocations of [foo]: ' +
        'expected [] not to be empty')
  });

  it('fails if number of invocation does not match', () => {
    return new Example((domain, server, dependencies) =>
      dependencies.foo('one'))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments()
        .withArguments())

      .promise.should.be.rejectedWith('Unexpected invocations of [foo]: ' +
        'expected 1 to equal 2')
  });

  it('fails if expected invocations does not match', () => {
    return new Example((domain, server, dependencies) => {
      dependencies.foo('one', 'uno');
      dependencies.foo('two', 'dos');
    })

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('not')
        .withArguments('two', 'dos'))

      .promise.should.be.rejectedWith("Unexpected invocations of [foo]: " +
        "expected [ [ 'one', 'uno' ], [ 'two', 'dos' ] ] " +
        "to deeply equal [ [ 'not' ], [ 'two', 'dos' ] ]")
  });

  it('asserts expected invocations with function', () => {
    return new Example((domain, server, dependencies) => {
      dependencies.foo('one', 'uno');
      dependencies.foo('two', 'dos');
    })

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('one', 'uno')
        .withArguments('two', a => a.should.equal('dos')))
  });

  it('fails if argument function fails', () => {
    return new Example((domain, server, dependencies) =>
      dependencies.foo('one'))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments(a => a.should.equal('two')))

      .promise.should.be.rejectedWith("Unexpected argument [0] " +
        "in invocation [0] of [foo]: " +
        "expected 'one' to equal 'two'")
  });

  const anyAction = {
    perform: example => new result.Result(example, Promise.resolve())
  };
});