const {Example, I, expect} = require('../../src/specification');

describe('Specifying HTTP Routes', () => {

  it('fails if the Route of a GET request is not defined', () => {
    return new Example(() => null)

      .when(I.get('/foo'))

      .done()

      .should.be.rejectedWith('No handler for [/foo] registered')
  });

  it('fails if the response does not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('baz'))

      .done()

      .should.be.rejectedWith("Unexpected response body: " +
        "expected 'bar' to deeply equal 'baz'");
  });

  it('asserts the expected response', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))

      .done()
  });

  it('fails if an expected Rejection is missing', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .done()

      .should.be.rejectedWith('Missing Rejection: ' +
        'expected 200 to equal 403')
  });

  it('asserts an expected Rejection', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) =>
        res.status(403).send({code: 'NOPE', message: 'ignored'})))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .done()
  });

  it('fails if the Rejection code does not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) =>
        res.status(403).send({code: 'NOPE'})))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOT_NOPE'))

      .done()

      .should.be.rejectedWith("Unexpected Rejection code: " +
        "expected 'NOPE' to equal 'NOT_NOPE'")
  });

  it('fails if an expected Error is not logged');

  it('asserts a logged Error');

  it('fails if an unexpected Error is logged');

  it('uses URL parameters and query arguments of GET request', () => {
    return new Example((domain, server) =>
      server.get('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.get('/greet/:name')
        .withUrlParameters({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))

      .done()
  });

  it('fails if the Route of a POST request is not defined');

  it('uses URL parameters and query arguments of POST request', () => {
    return new Example((domain, server) =>
      server.post('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.post('/greet/:name')
        .withUrlParameters({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))

      .done()
  });

  it('uses body of POST request', () => {
    return new Example((domain, server) =>
      server.post('/foo', (req, res) => res.send('Hello ' + req.body.name)))

      .when(I.post('/foo')
        .withBody({name: 'BAR'}))

      .then(expect.Response('Hello BAR'))

      .done()
  })
});