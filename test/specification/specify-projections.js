const k = require('../../src/karma');
const {Example, the, I, expect} = require('../../src/specification');

describe('Specifying Projections', () => {

  let module = configure => (domain, server) => {

    domain.add(configure(new k.Projection('foo')
      .initializing(function () {
        this.state = [];
      })
      .respondingTo('Foo', ()=>'foo', function () {
        return this.state
      })));

    server.get('/foo', (req, res) =>
      domain.respondTo(new k.Query('Foo'))
        .then(response => res.send(response)))
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

      .givenAll([
        the.Event('food').withTime('2011-12-13'),
        the.Event('food').withTime('2001-02-03')
      ])

      .when(I.get('/foo'))

      .then(expect.Response([2, 6]))
  })
});