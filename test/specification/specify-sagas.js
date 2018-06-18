const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec');

describe('Specifying Sagas', () => {

  it('uses a published Event to trigger the reaction', () => {
    let reacted = [];

    return new Example(domain =>
      domain.add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', $=>reacted.push($))))

      .when(I.publish(the.Event('food', 'bar')))

      .promise.then(() => reacted.should.eql(['bar']))
  });

  it('does not use recorded Events to trigger the reaction', () => {
    let reacted = [];

    return new Example(domain =>
      domain.add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', $=>reacted.push($))))

      .given(the.Event('food', 'not'))

      .when(I.publish(the.Event('food', 'bar')))

      .promise.then(() => reacted.should.eql(['bar']))
  });

  it('asserts expected failure of reaction', () => {
    return new Example(domain =>
      domain.add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => {
          throw new Error('Nope');
        })))

      .when(I.publish(the.Event('food')))

      .then(expect.Failure('Nope'))
  });

  it('fails if expected failure is missing', () => {
    return new Example(domain =>
      domain.add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => {
          throw new Error('Not Nope');
        })))

      .when(I.publish(the.Event('food')))

      .then(expect.Failure('Nope'))

      .promise.should.be.rejectedWith("Missing reaction failure: " +
        "expected [ 'Not Nope' ] to include 'Nope'")
  });

  it('fails is reaction fails unexpectedly', () => {
    return new Example(domain =>
      domain.add(new k.Saga('One')
        .reactingTo('food', ()=>'foo', () => {
          throw new Error('Nope');
        })))

      .when(I.publish(the.Event('food')))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Reaction failed: food")
      })

      .then({assert: result => result.example.metaStore.recorded.splice(0, 2)})
  });
});
