const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Aggregates', () => {

  const module = configure => domain => {

    domain.add(configure(new k.Aggregate('One'))
      .initializing(function () {
        this.state = {
          foo: 'bar',
          bar: 'foo'
        };
      })
      .executing('Foo', ()=>'foo', function () {
        return [
          new k.Event('food', {foo: this.state.foo}),
          new k.Event('bard', {bar: this.state.bar})
        ]
      }));

    return new k.api.http.RequestHandler()
      .handling(new k.api.http.CommandHandler(domain, () => new k.Command('Foo')))
  };

  it('asserts recorded Events', () => {
    return new Example(module(x=>x))

      .when(I.post())

      .then(expect.Response())

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('fails if the Command is rejected', () => {
    return new Example(domain => {
      domain.add(new k.Aggregate('One')
        .executing('Foo', ()=>'foo', () => {
          throw new k.Rejection('NOPE')
        }));

      return {handle: () => domain.execute(new k.Command('Foo'))}
    })

      .when(I.post('/foo'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.eql('Unexpected Rejection: ' +
          'expected [Rejection: NOPE] to not exist')
      })

      .then({assert: result => result.rejection = null})
  });

  it('uses recorded Events', () => {
    return new Example(module(aggregate=>aggregate
      .applying('bazd', function ({one, two}) {
        this.state[one] = two;
      })
      .applying('band', function ({uno, dos}) {
        this.state[uno] = dos;
      })
    ))

      .given(the.EventStream('foo', [
        the.Event('bazd', {one: 'foo', two: 'baz'}),
        the.Event('band', {uno: 'bar', dos: 'ban'}),
      ]))

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'baz'}),
        expect.Event('bard', {bar: 'ban'})
      ]))
  });

  it('does not use recorded Events of other Stream', () => {
    return new Example(module(aggregate =>aggregate
      .applying('bazd', function ({one, two}) {
        this.state[one] = two;
      })
    ))

      .given(the.EventStream('not foo', [
        the.Event('bazd', {one: 'foo', two: 'baz'}),
      ]))

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('fails no ID of expected Event stream does not match', () => {
    return new Example(module(aggregate=>aggregate))

      .when(I.post('/foo'))

      .then(expect.EventStream('not foo', []))

      .promise.should.be.rejectedWith("Unexpected Event stream ID: " +
        "expected 'foo' to equal 'not foo'")
  });

  it('fails if expected Event was not recorded', () => {
    return new Example(module(aggregate=>aggregate))

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('not food')
      ]))

      .promise.should.be.rejectedWith("Event not recorded: " +
        "expected [ 'food', 'bard' ] to deeply equal [ 'not food' ]")
  });

  it('fails if expected do not match recorded Events', () => {
    return new Example(module(aggregate=>aggregate))

      .when(I.post('/foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'not'}),
        expect.Event('bard', {bar: 'not'})
      ]))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ Array(2) ] to deeply equal [ Array(2) ]")
  });

  it('fails if Event is not expected inside Stream', () => {
    return new Example(module(aggregate=>aggregate))

      .when(I.post('/foo'))

      .then(expect.Event())

      .promise.should.be.rejectedWith('Events must be expected in an EventStream')
  });
});