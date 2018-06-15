const {Example, I, expect} = require('../../src/specification');

describe('Specifying HTTP Routes', () => {

  it('fails if the Route of a GET request is not defined', () => {
    return new Example(() => null)

      .when(I.get('/foo'))

      .should.be.rejectedWith('No handler for [GET /foo] registered')
  });

  it('fails if the response does not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('baz'))

      .should.be.rejectedWith("Unexpected response body: " +
        "expected 'bar' to deeply equal 'baz'");
  });

  it('asserts the expected response', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('fails if an expected Rejection is missing', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('bar')))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .should.be.rejectedWith('Missing Rejection: ' +
        'expected 200 to equal 403')
  });

  it('asserts an expected Rejection', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) =>
        res.status(403).send({code: 'NOPE', message: 'ignored'})))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))
  });

  it('fails if the Rejection code does not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) =>
        res.status(403).send({code: 'NOPE'})))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOT_NOPE'))

      .should.be.rejectedWith("Unexpected Rejection code: " +
        "expected 'NOPE' to equal 'NOT_NOPE'")
  });

  it('fails if an expected Error is not logged', () => {
    return new Example((domain, server) =>
      server.get('/foo', () => console.error('Not Nope')))

      .when(I.get('/foo'))

      .then(expect.Error('Nope'))

      .should.be.rejectedWith("Missing Error: " +
        "expected [ 'Not Nope' ] to include 'Nope'")

      .then({assert: result => result.errors.splice(0, 1)})
  });

  it('asserts a logged Error', () => {
    return new Example((domain, server) =>
      server.get('/foo', () => console.error('Nope')))

      .when(I.get('/foo'))

      .then(expect.Error('Nope'))
  });

  it('fails if an unexpected Error is logged', () => {
    return new Example((domain, server) =>
      server.get('/foo', () => console.error('Nope')))

      .when(I.get('/foo'))

      .should.be.rejectedWith("Unexpected Error(s): " +
        "expected [ 'Nope' ] to be empty")

      .then({assert: result => result.errors.splice(0, 1)})
  });

  it('uses URL parameters and query arguments of GET request', () => {
    return new Example((domain, server) =>
      server.get('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.get('/greet/:name')
        .withUrlParameters({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('fails if the Route of a POST request is not defined', () => {
    return new Example(() => null)

      .when(I.post('/foo'))

      .should.be.rejectedWith('No handler for [POST /foo] registered')
  });

  it('uses URL parameters and query arguments of POST request', () => {
    return new Example((domain, server) =>
      server.post('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}`)))

      .when(I.post('/greet/:name')
        .withUrlParameters({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('uses body of POST request', () => {
    return new Example((domain, server) =>
      server.post('/foo', (req, res) => res.send('Hello ' + req.body.name)))

      .when(I.post('/foo')
        .withBody({name: 'BAR'}))

      .then(expect.Response('Hello BAR'))
  });

  it('registers Routes as middleware', () => {
    let example = new Example((domain, server) =>
      server.use('/foo', (req, res) => res.send('bar')));

    return Promise.all([

      example
        .when(I.post('/foo'))
        .then(expect.Response('bar')),

      example
        .when(I.get('/foo'))
        .then(expect.Response('bar'))
    ])
  });

  it('fails if header is missing', () => {
    return new Example((domain, server) =>
      server.get('/foo', () => null))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({not: 'set'}))

      .should.be.rejectedWith("expected {} to have key 'not'")
  });

  it('fails if header value doe not match', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => {
        res.header('not', 'bar');
      }))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({not: 'baz'}))

      .should.be.rejectedWith("Unexpected value of header [not]: expected 'bar' to equal 'baz'")
  });

  it('asserts headers of response', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => {
        res.setHeader('One', 'uno');
        res.header('Two', 'dos');
        res.set('Three', 'tre');
      }))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({
          One: 'uno',
          Two: 'dos'
        }))
  });

  it('assert content sent with response.end()', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.end('bar')))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('converts Buffer to string', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send(new Buffer('bar'))))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('parses JSON string', () => {
    return new Example((domain, server) =>
      server.get('/foo', (req, res) => res.send('{"bar":"baz"}')))

      .when(I.get('/foo'))

      .then(expect.Response({bar: 'baz'}))
  });
});