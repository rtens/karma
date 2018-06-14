const {Example, I, expect} = require('../../src/specification');

describe('Specifying HTTP Routes', () => {

  it('fails if the Route is not defined', () => {
    return new Example(() => null)

      .when(I.get('/foo'))

      .then(expect.Response())

      .should.be.rejectedWith('expected 200 "OK", got 404 "Not Found"')
  });

  it('fails if the response does not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('baz'))

      .should.be.rejectedWith("expected 'baz' response body, got 'bar'");
  });

  it('uses URL parameters and query arguments of GET request', () => {
    return new Example((domain, server) =>
      server.get('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.get('/greet/foo')
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('uses URL parameters and query arguments of POST request', () => {
    return new Example((domain, server) =>
      server.post('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.post('/greet/foo')
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('uses body of POST request', () => {
    return new Example((domain, server) =>
      server.post('/foo', (req, res) => res.send('Hello ' + req.body.name)))

      .when(I.post('/foo')
        .withBody({name: 'BAR'}))

      .then(expect.Response('Hello BAR'))
  })
});