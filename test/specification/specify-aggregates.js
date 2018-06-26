const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Aggregates', () => {

  const Module = configure => class extends k.api.http.Module {
    //noinspection JSUnusedGlobalSymbols
    buildDomain() {
      return super.buildDomain()
        .add(configure(new k.Aggregate('One'))
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
    }

    //noinspection JSUnusedGlobalSymbols
    buildHandler() {
      return new k.api.http.RequestHandler()
        .handling(new k.api.http.CommandHandler(this.domain, request =>
          new k.Command(request.path)))
    }
  };

  it('asserts recorded Events', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.Response())

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('fails if the Command is rejected', () => {
    return new Example(Module(aggreagte => aggreagte
      .executing('Bar', ()=>'foo', () => {
        throw new k.Rejection('NOPE')
      })))

      .when(I.post('Bar'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.eql('Unexpected Rejection: ' +
          'expected [Rejection: NOPE] to not exist')
      })

      .then({assert: result => result.rejection = null})
  });

  it('uses recorded Events', () => {
    return new Example(Module(aggregate => aggregate
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

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'baz'}),
        expect.Event('bard', {bar: 'ban'})
      ]))
  });

  it('does not use recorded Events of other Stream', () => {
    return new Example(Module(aggregate => aggregate
      .applying('bazd', function ({one, two}) {
        this.state[one] = two;
      })
    ))

      .given(the.EventStream('not foo', [
        the.Event('bazd', {one: 'foo', two: 'baz'}),
      ]))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('fails if no stream was recorded', () => {
    return new Example(Module(aggreagte => aggreagte
      .executing('Bar', ()=>'foo', () => null)))

      .when(I.post())

      .then(expect.EventStream('foo', []))

      .promise.should.be.rejectedWith("No streams recorded: " +
        "expected undefined to exist")
  });

  it('fails no ID of expected Event stream does not match', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('not foo', []))

      .promise.should.be.rejectedWith("Unexpected Event stream ID: " +
        "expected 'foo' to equal 'not foo'")
  });

  it('fails if expected Event was not recorded', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('not food')
      ]))

      .promise.should.be.rejectedWith("Event not recorded: " +
        "expected [ 'food', 'bard' ] to deeply equal [ 'not food' ]")
  });

  it('fails if expected do not match recorded Events', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'not'}),
        expect.Event('bard', {bar: 'not'})
      ]))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ Array(2) ] to deeply equal [ Array(2) ]")
  });

  it('fails if Event is not expected inside Stream', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.Event())

      .promise.should.be.rejectedWith('Events must be expected in an EventStream')
  });
});