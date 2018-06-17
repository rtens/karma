const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {Example, I, expect} = require('../../spec');

describe('Specifying Aggregates', () => {

  const module = (domain, server) => {
    domain.add(new k.Aggregate('One')
      .executing('Foo', ()=>'foo', () => [
        new k.Event('food', {foo: 'bar'}),
        new k.Event('bard', {bar: 'foo'})
      ]));
    server.post('/foo', (req, res) =>
      domain.execute(new k.Command('Foo')))
  };

  it('asserts recorded Events', () => {
    return new Example(module)

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))

      .then(expect.Response())
  });

  it('fails no ID of expected Event stream does not match', () => {
    return new Example(module)

      .when(I.post('/foo'))

      .then(expect.EventStream('not foo', []))

      .promise.should.be.rejectedWith("Unexpected Event stream ID: " +
        "expected 'foo' to equal 'not foo'")
  });

  it('fails if expected Event was not recorded', () => {
    return new Example(module)

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('not food')
      ]))

      .promise.should.be.rejectedWith("Event not recorded: " +
        "expected [ 'food', 'bard' ] to deeply equal [ 'not food' ]")
  });

  it('fails if expected do not match recorded Events', () => {
    return new Example(module)

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'not'}),
        expect.Event('bard', {bar: 'not'})
      ]))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ Array(2) ] to deeply equal [ Array(2) ]")
  });

  it('fails if Event is not expected inside Stream', () => {
    return new Example(module)

      .when(I.post('/foo'))

      .then(expect.Event())

      .promise.should.be.rejectedWith('Events must be expected in an EventStream')
  });
});