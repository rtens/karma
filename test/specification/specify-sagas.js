const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Sagas', () => {

  const Module = (saga, domain = x=>x) => class extends k.Module {
    //noinspection JSUnusedGlobalSymbols
    buildDomain() {
      return domain(super.buildDomain())
        .add(saga(new k.Saga('One')))
    }

    handle() {
      return this.domain.execute(new k.Command('Foo'))
    }
  };

  it('uses a published Event to trigger the reaction', () => {
    let reacted = [];

    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', $=>reacted.push($))))

      .when(I.publish(the.Event('food', 'bar')))

      .promise.then(() => reacted.should.eql(['bar']))
  });

  it('catches unresolved promises', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', () => new Promise(() => null))))

      .when(I.publish(the.Event()))
  });

  it('asserts expected failure of reaction', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', () => {
        throw new Error('Nope');
      })))

      .when(I.publish(the.Event('food')))

      .then(expect.Failure('Nope'))
  });

  it('asserts expected failure through Rejection of reaction', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', () => {
        throw new k.Rejection('Nope');
      })))

      .when(I.publish(the.Event('food')))

      .then(expect.Failure('Nope'))
  });

  it('fails if expected failure is missing', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', () => {
        throw new Error('Not Nope');
      })))

      .when(I.publish(the.Event('food')))

      .then(expect.Failure('Nope'))

      .promise.should.be.rejectedWith("Missing reaction failure: " +
        "expected [ 'Not Nope' ] to include 'Nope'")
  });

  it('fails is reaction fails unexpectedly', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', () => {
        throw new Error('Nope');
      })))

      .when(I.publish(the.Event('food')))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Reaction failed: food")
      })

      .then({assert: result => result.example.errors.splice(0, 2)})
      .then({assert: result => result.example.metaStore.recorded.splice(0, 2)})
  });

  it('asserts logged Errors', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', (payload, record, log) =>
        log.error(new Error('Nope')))))

      .when(I.publish(the.Event('food')))

      .then(expect.LoggedError('Nope'))
  });

  it('fails if unexpected Error is logged', () => {
    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', (payload, record, log) =>
        log.error(new Error('Nope')))))

      .when(I.publish(the.Event('food')))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Unexpected Error(s): " +
          "expected [ 'Nope' ] to deeply equal []");
        err.stack.should.contain('Caused by: Error: Nope');
      })

      .then({assert: result => result.example.errors.splice(0, 1)})
  });

  it('applies published Event before reacting to it', () => {
    let reacted = [];

    return new Example(Module(saga => saga
      .initializing(function () {
        this.state = [];
      })
      .applying('food', function ($) {
        this.state.push($);
      })
      .reactingTo('food', ()=>'foo', function() {
        reacted.push(this.state)
      })))

      .when(I.publish(the.Event('food', 'bar')))

      .promise.then(() => reacted.should.eql([['bar']]))
  });

  it('does not use recorded Events to trigger the reaction', () => {
    let reacted = [];

    return new Example(Module(saga => saga
      .reactingTo('food', ()=>'foo', $ => reacted.push($))))

      .given(the.Event('food', 'not'))

      .when(I.publish(the.Event('food', 'bar')))

      .promise.then(() => reacted.should.eql(['bar']))
  });

  it('does not use Events recorded by a Command to trigger the reaction', () => {
    let reacted = [];

    return new Example(Module(

      saga => saga
        .reactingTo('food', ()=>'foo', $=>reacted.push($)),

      domain => domain
        .add(new k.Aggregate('One')
          .executing('Foo', ()=>'foo', () => [new k.Event('food', 'not')]))))

      .when(I.post())

      .promise.then(() => reacted.should.eql([]))
  })
})
;
