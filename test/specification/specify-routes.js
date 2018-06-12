const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const Specification = require('../../src/specification');

describe('Specifying HTTP Routes', () => {

  it('fails if the Route is not defined', () => {
    return new Specification(() => null)

      .whenGetting('/foo')

      .expectResponse()

      .should.be.rejectedWith('expected 200 "OK", got 404 "Not Found"')
  });

  it('fails if the response does not match', () => {
    return new Specification((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .whenGetting('/foo')

      .expectResponse('baz')

      .should.be.rejectedWith("expected 'baz' response body, got 'bar'");
  });

  it('uses URL parameters and query arguments of GET request', () => {
    return new Specification((domain, server) =>
      server.get('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .whenGetting('/greet/foo', {greeting: 'hello'})

      .expectResponse('hello foo')
  });

  it('uses URL parameters and query arguments of POST request', () => {
    return new Specification((domain, server) =>
      server.post('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .whenPosting('/greet/foo', {greeting: 'hello'})

      .expectResponse('hello foo')
  });

  it('uses body of POST request', () => {
    return new Specification((domain, server) =>
      server.post('/foo', (req, res) => res.send('Hello ' + req.body.name)))

      .whenPosting('/foo')
      .withBody({name: 'BAR'})

      .expectResponse('Hello BAR')
  })
});