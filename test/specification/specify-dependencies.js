const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, expect} = require('../../spec')();
const specification = require('../../src/specification');

describe('Specifying dependencies', () => {

  const Module = initialize => class extends k.Module {
    //noinspection JSUnusedGlobalSymbols
    buildDomain() {
      initialize(this.dependencies);
    }
  };

  it('uses injected values', () => {
    let injected = null;

    new Example(Module(dependencies =>
      injected = dependencies.foo))

      .given(the.Value('foo', 'bar'))

      .when(anyAction);

    injected.should.equal('bar');
  });

  it('uses injected stub', () => {
    let stubbed = null;

    new Example(Module(dependencies =>
      stubbed = [dependencies.foo(), dependencies.bar()]))

      .given(the.Stub('foo').returning('FOO'))
      .given(the.Stub('bar()').returning('BAR'))

      .when(anyAction);

    stubbed.should.eql(['FOO', 'BAR']);
  });

  it('uses dynamic stub', () => {
    let stubbed = null;

    new Example(Module(dependencies =>
      stubbed = dependencies.foo('foo', 'bar')))

      .given(the.Stub('foo')
        .calling((a, b) => a + b))

      .when(anyAction);

    stubbed.should.equal('foobar');
  });

  it('uses dynamic stub with indexed callback', () => {
    let stubbed = [];

    new Example(Module(dependencies => {
      stubbed.push(dependencies.foo(3, 4));
      stubbed.push(dependencies.foo(5, 6));
      stubbed.push(dependencies.foo(7, 8));
    }))

      .given(the.Stub('foo')
        .callingIndexed(i => (a, b) => a + b * i))

      .when(anyAction);

    stubbed.should.eql([3, 11, 23]);
  });

  it('uses dynamic stub with singular behaviour', () => {
    let stubbed = [];

    new Example(Module(dependencies => {
      stubbed.push(dependencies.foo());
      stubbed.push(dependencies.foo());
      stubbed.push(dependencies.foo());
      stubbed.push(dependencies.foo());
      stubbed.push(dependencies.foo());
    }))

      .given(the.Stub('foo')
        .returning('one')
        .returning('two')
        .calling(() => 'tre')
        .returning('for'))

      .when(anyAction);

    stubbed.should.eql(['one', 'two', 'tre', 'for', 'for']);
  });

  it('uses injected values in objects', () => {
    let injected = null;

    new Example(Module(dependencies =>
      injected = dependencies.foo.bar.baz))

      .given(the.Value('foo.bar.baz', 'ban'))

      .when(anyAction);

    injected.should.equal('ban');
  });

  it('uses injected values returned by function', () => {
    let injected = null;

    new Example(Module(dependencies =>
      injected = dependencies.foo().bar().baz))

      .given(the.Value('foo().bar().baz', 'ban'))

      .when(anyAction);

    injected.should.equal('ban');
  });

  it('asserts expected invocations of static stubs', () => {
    return new Example(Module(dependencies => {
      dependencies.foo('a');
      dependencies.foo('b').bar('one', 'uno');
    }))

      .given(the.Stub('foo().bar'))

      .when(anyAction)

      .then(expect.Invocations('foo()')
        .withArguments('a')
        .withArguments('b'))

      .then(expect.Invocations('foo')
        .withArguments('a')
        .withArguments('b'))

      .then(expect.Invocations('foo().bar')
        .withArguments('one', 'uno'))

      .then(expect.Invocations('foo().bar()')
        .withArguments('one', 'uno'))
  });

  it('asserts expected invocations of dynamic stub', () => {
    return new Example(Module(dependencies => {
      dependencies.foo('one');
    }))

      .given(the.Stub('foo').calling(() => 'bar'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('one'))
  });

  it('counts instantiations as invokations', () => {
    return new Example(Module(dependencies => {
      new dependencies.foo('one');
    }))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('one'))
  });

  it('combines injected values', () => {
    let injected = [];

    return new Example(Module(dependencies => {
      injected.push(dependencies.foo('a'));
      injected.push(dependencies.foo.bar('b').ban('c'));
      injected.push(dependencies.foo.baz);
    }))

      .given(the.Stub('foo').returning('one'))
      .given(the.Stub('foo.bar'))
      .given(the.Stub('foo.bar().ban').returning('two'))
      .given(the.Value('foo.baz', 'tre'))

      .when(anyAction)

      .then({assert: () => injected.should.eql(['one', 'two', 'tre'])})
      .then(expect.Invocations('foo').withArguments('a'))
      .then(expect.Invocations('foo.bar').withArguments('b'))
      .then(expect.Invocations('foo.bar()').withArguments('b'))
      .then(expect.Invocations('foo.bar().ban').withArguments('c'))
  });

  it('fails if stub does not exist', () => {
    return new Example(Module(() => null))

      .when(anyAction)

      .then(expect.Invocations('foo'))

      .promise.should.be.rejectedWith('Stub [foo] not found: ' +
        'expected undefined to exist')
  });

  it('fails if expected invocation is missing', () => {
    return new Example(Module(() => null))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo'))

      .promise.should.be.rejectedWith('Missing invocations of [foo]: ' +
        'expected [] not to be empty')
  });

  it('fails if number of invocation does not match', () => {
    return new Example(Module(dependencies =>
      dependencies.foo('one')))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments(1)
        .withArguments(2))

      .promise.should.be.rejectedWith('Unexpected invocations of [foo]: ' +
        "expected [ [ 'one' ] ] to deeply equal [ [ 1 ], [ 2 ] ]")
  });

  it('fails if expected invocations does not match', () => {
    return new Example(Module(dependencies => {
      dependencies.foo('one', 'uno');
      dependencies.foo('two', 'dos');
    }))

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
    return new Example(Module(dependencies => {
      dependencies.foo('one', 'uno');
      dependencies.foo('two', 'dos');
    }))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments('one', 'uno')
        .withArguments('two', a => a.should.equal('dos')))
  });

  it('fails if argument function fails', () => {
    return new Example(Module(dependencies =>
      dependencies.foo('one')))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.Invocations('foo')
        .withArguments(a => a.should.equal('two')))

      .promise.should.be.rejectedWith("Unexpected argument [0] " +
        "in invocation [0] of [foo]: " +
        "expected 'one' to equal 'two'")
  });

  it('assert no invocations', () => {
    return new Example(Module(dependencies => dependencies))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.NoInvocations('foo'))
      .then(expect.NoInvocations('foo()'))
  });

  it('fails if stub without expected invocation does not exist', () => {
    return new Example(Module(dependencies => dependencies))

      .when(anyAction)

      .then(expect.NoInvocations('foo'))

      .promise.should.be.rejectedWith('Stub [foo] not found: ' +
        'expected undefined to exist')
  });

  it('fails for unexpected invocations', () => {
    return new Example(Module(dependencies => dependencies.foo()))

      .given(the.Stub('foo'))

      .when(anyAction)

      .then(expect.NoInvocations('foo'))

      .promise.should.be.rejectedWith("Unexpected invocations of [foo]: " +
        "expected [ [] ] to deeply equal []")
  });

  const anyAction = {
    perform: example => new specification.Result(example, Promise.resolve())
  };
});