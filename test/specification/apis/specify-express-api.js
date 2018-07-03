const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../index.js');
const {Example, I, expect} = require('../../../spec')({api: 'express'});

describe('Specifying an express API', () => {

  const Module = configure => class extends k.api.express.Module {
    //noinspection JSUnusedGlobalSymbols
    buildHandler(app) {
      return super.buildHandler(configure(app, this))
    }
  };

  it('fails if the Route of a GET request is not defined', () => {
    return new Example(Module(server => server))

      .when(I.get('/foo'))

      .promise.should.be.rejectedWith('Cannot GET /foo')
  });

  it('ignores if no response was sent', () => {
    return new Example(Module(server => server
      .get('/foo', () => null)))

      .when(I.get('/foo'))
  });

  it('fails if the response does not match', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.status(201).send('bar'))))

      .when(I.get('/foo'))

      .then(expect.Response('baz'))

      .promise.should.be.rejectedWith("Unexpected response body: " +
        "expected 'bar' to deeply equal 'baz'");
  });

  it('fails if the response status does not match', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.status(201).send('bar'))))

      .when(I.get('/foo'))

      .then(expect.Response('bar')
        .withStatus(202))

      .promise.should.be.rejectedWith("Unexpected response status: " +
        "expected 201 to equal 202");
  });

  it('asserts the expected response', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.send('bar'))))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('fails if an expected Rejection is missing', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.send('bar'))))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .promise.should.be.rejectedWith('Missing Rejection: ' +
        'expected 200 to equal 403')
  });

  it('asserts an expected Rejection', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res, next) =>
        next(new k.Rejection('NOPE', 'Nope')))))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))
  });

  it('asserts an expected thrown Rejection', () => {
    return new Example(Module(server => server
      .get('/foo', () => {
        throw new k.Rejection('NOPE', 'Nope')
      })))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))
  });

  it('fails if the Rejection code does not match', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res, next) => {
        next(new k.Rejection('NOPE', 'Nope'))
      })))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOT_NOPE'))

      .promise.should.be.rejectedWith("Unexpected Rejection code: " +
        "expected 'NOPE' to equal 'NOT_NOPE'")
  });

  it('fails if an expected Error is not logged', () => {
    return new Example(Module((server, module) => server
      .get('/foo', () => module.logger.error('foo', 'bar', new Error('Not Nope')))))

      .when(I.get('/foo'))

      .then(expect.LoggedError('Nope'))

      .promise.should.be.rejectedWith("Missing Error: " +
        "expected [ 'Not Nope' ] to include 'Nope'")

      .then({assert: result => result.errors.splice(0, 1)})
  });

  it('asserts a logged Error', () => {
    return new Example(Module((server, module) => server
      .get('/foo', () => module.logger.error('foo', 'bar', new Error('Nope')))))

      .when(I.get('/foo'))

      .then(expect.LoggedError('Nope'))
  });

  it('fails if an unexpected Error is logged', () => {
    return new Example(Module((server, module) => server
      .get('/foo', () => module.logger.error('foo', 'bar', new Error('Nope')))))

      .when(I.get('/foo'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Unexpected Error(s): " +
          "expected [ 'Nope' ] to deeply equal []");
        err.stack.should.contain('Caused by: Error: Nope');
      })

      .then({assert: result => result.example.errors.splice(0, 1)})
  });

  it('fails if an unexpected Error is thrown', () => {
    return new Example(Module((server, module) => server
      .get('/foo', () => {
        throw new Error('Nope')
      })))

      .when(I.get('/foo'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Unexpected Error(s): " +
          "expected [ 'Nope' ] to deeply equal []");
        err.stack.should.contain('Caused by: Error: Nope');
      })

      .then({assert: result => result.example.errors.splice(0, 1)})
  });

  it('uses headers, URL parameters and query arguments of GET request', () => {
    return new Example(Module(server => server
      .get('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}${req.headers.mark}`))))

      .when(I.get('/greet/foo')
        .withHeaders({mark: '!'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo!'))
  });

  it('fails if the Route of a POST request is not defined', () => {
    return new Example(Module(server => server))

      .when(I.post('/foo'))

      .promise.should.be.rejectedWith(k.api.NotFoundError, 'Cannot POST /foo')
  });

  it('uses headers, URL parameters and query arguments of POST request', () => {
    return new Example(Module(server => server
      .post('/greet/:name', (req, res) =>
        res.send(`${req.query.greeting} ${req.params.name}${req.headers.mark}`))))

      .when(I.post('/greet/foo')
        .withHeaders({mark: '!'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo!'))
  });

  it('uses body of POST request', () => {
    return new Example(Module(server => server
      .post('/foo', (req, res) => res.send('Hello ' + req.body.name))))

      .when(I.post('/foo')
        .withBody({name: 'BAR'}))

      .then(expect.Response('Hello BAR'))
  });

  it('registers Routes as middleware', () => {
    const example = new Example(Module(server => server
      .use('/foo', (req, res) => res.send('bar'))));

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
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.send())))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({not: 'set'}))

      .promise.should.be.rejectedWith("Missing header: " +
        "expected { 'X-Powered-By': 'Express' } to have key 'not'")
  });

  it('fails if header value doe not match', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.header('not', 'bar').end())))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({not: 'baz'}))

      .promise.should.be.rejectedWith("Unexpected value of header [not]: " +
        "expected 'bar' to equal 'baz'")
  });

  it('asserts headers of response', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => {
        res.setHeader('One', 'uno');
        res.header('Two', 'dos');
        res.set('Three', 'tre');
        res.send()
      })))

      .when(I.get('/foo'))

      .then(expect.Response()
        .withHeaders({
          One: 'uno',
          Two: 'dos'
        }))
  });

  it('assert content sent with response.end()', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.end('bar'))))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('parses JSON string', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.send('{"bar":"baz"}'))))

      .when(I.get('/foo'))

      .then(expect.Response({bar: 'baz'}))
  });

  it('fails gracefully to parse JSON string', () => {
    return new Example(Module(server => server
      .get('/foo', (req, res) => res.send('not json'))))

      .when(I.get('/foo'))

      .then(expect.Response({bar: 'baz'}))

      .promise.should.be.rejectedWith("Unexpected response body: " +
        "expected 'not json' to deeply equal { bar: 'baz' }")
  });

  it('waits for asynchronous results', () => {
    let result;

    return new Example(Module(server => server
      .get('/foo', (req, res) => {
        res.send();

        setTimeout(() => result = 'delayed', 0)
      })))

      .when(I.get('/foo'))

      .then({assert: () => chai.expect(result).to.equal('delayed')})
  })
});