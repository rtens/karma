const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Projections', () => {

  let module = configure => domain => {

    domain.add(configure(new k.Projection('foo')
      .initializing(function () {
        this.state = [];
      })
      .respondingTo('Foo', ()=>'foo', function () {
        return this.state
      })));

    return new k.api.http.RequestHandler()
      .handling(new k.api.http.QueryHandler(domain, () => new k.Query('Foo')))
  };

  it('uses recorded Events', () => {
    return new Example(module(projection =>
      projection.applying('food', function ($) {
        this.state.push($)
      })))

      .given(the.Event('food', 'one'))
      .given(the.Event('food', 'two'))

      .when(I.get('/foo'))

      .then(expect.Response(['one', 'two']))
  });

  it('uses time of recorded Events', () => {
    return new Example(module(projection =>
      projection.applying('food', function ($, record) {
        this.state.push(record.event.time.getDay())
      })))

      .given([
        the.Event('food').withTime('2011-12-13'),
        the.Event('food').withTime('2001-02-03')
      ])
      .given(the.Event('food').withTime('2013-12-11'))

      .when(I.get('/foo'))

      .then(expect.Response([2, 6, 3]))
  });

  it('fails if the Query is rejected', () => {
    return new Example(domain => {
      domain.add(new k.Projection('foo')
        .respondingTo('Foo', ()=>'foo', function () {
          throw new k.Rejection('NOPE')
        }));

      return {handle: () => domain.respondTo(new k.Query('Foo'))}
    })

      .when(I.get('/foo'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.eql('Unexpected Rejection: ' +
          'expected [Rejection: NOPE] to not exist')
      })

      .then({assert: result => result.rejection = null})
  });
});