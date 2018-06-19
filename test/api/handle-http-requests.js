const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const http = require('../../src/apis/http');

describe('Handling HTTP requests', () => {

  it('fails if not handler matches', () => {
    return new http.RequestHandler()

      .handle(new http.Request('GET', '/foo'))
      .should.be.rejectedWith(http.NotFoundError, 'Cannot handle [GET /foo]')
  });

  it('returns a response', () => {
    return new http.RequestHandler()
      .handling(req => 'Hello ' + req.path)

      .handle(new http.Request('GET', '/foo'))
      .should.eventually.eql('Hello /foo')
  });

  it('receives payloads', () => {
    return new http.RequestHandler()
      .handling(req => req.body + req.query)

      .handle(new http.Request()
        .withBody('Foo')
        .withQuery('Bar'))
      .should.eventually.eql('FooBar')
  });

  it('receives and sends status code and headers', () => {
    return new http.RequestHandler()
      .handling(req => new http.Response()
        .withStatus(123)
        .withHeader('Foo', 'bar')
        .withBody('Hello ' + req.headers.Name))

        .handle(new http.Request()
          .withHeader('Name', 'Foo'))
        .then(response => {
          response.statusCode.should.eql(123);
          response.headers.Foo.should.eql('bar');
          response.body.should.eql('Hello Foo')
        })
  });

  it('transforms the request before handling it', () => {
    return new http.RequestHandler()
      .beforeRequest(req => Promise.resolve(({foo: 'foo' + req.path})))
      .handling(req => 'Hello ' + req.foo)
      .beforeRequest(req => ({foo: req.foo + '/baz'}))

      .handle(new http.Request('GET', '/bar'))
      .should.eventually.eql('Hello foo/bar/baz')
  });

  it('transforms the response before returning it', () => {
    return new http.RequestHandler()
      .afterResponse(res => Promise.resolve('Hello ' + res))
      .handling(req => req.path)
      .afterResponse(res => res + '/baz')

      .handle(new http.Request('GET', '/bar'))
      .should.eventually.eql('Hello /bar/baz')
  });

  it('throws errors', () => {
    return new http.RequestHandler()
      .handling(() => {
        throw new Error('Nope')
      })

      .handle(new http.Request())
      .should.be.rejectedWith(Error, 'Nope')
  });

  it('catches errors', () => {
    return new http.RequestHandler()
      .handling(() => {
        throw new Error('Nope')
      })
      .catching((err, req) => req.method + req.path + ': ' + err.message)

      .handle(new http.Request('GET', '/foo'))
      .should.eventually.eql('GET/foo: Nope')
  });

  it('catches specific error', () => {
    class FooError extends Error {
      constructor(foo) {
        super('bla');
        this.foo = foo;
      }
    }

    class BarError extends Error {
    }

    return new http.RequestHandler()
      .handling(() => {
        throw new FooError('Nope')
      })
      .catchingError(BarError, () => 'Not caught here')
      .catchingError(FooError, err => err.foo)
      .catching(() => 'Neither caught here')

      .handle(new http.Request())
      .should.eventually.eql('Nope')
  });

  it('delegates request to next handler', () => {
    return new http.RequestHandler()
      .handling(new http.RequestHandler()
        .handling(req => 'Deep ' + req.path))

      .handle(new http.Request('GET', '/foo'))
      .should.eventually.eql('Deep /foo')
  });

  it('delegates to matching handler', () => {
    let handler = new http.RequestHandler()
      .handling(new http.RequestHandler()
        .matching(req => req.body == 'foo')
        .handling(req => 'food'))
      .handling(new http.RequestHandler()
        .matching(req => req.body == 'bar')
        .handling(req => 'bard'));

    return Promise.all([
      handler.handle(new http.Request().withBody('foo'))
        .should.eventually.eql('food'),

      handler.handle(new http.Request().withBody('bar'))
        .should.eventually.eql('bard'),
    ])
  });

  it('matches request method', () => {
    let handler = new http.RequestHandler()
      .handling(new http.RequestHandler()
        .matchingMethod('Foo')
        .handling(req => 'food ' + req.path))
      .handling(new http.RequestHandler()
        .matchingMethod('baR')
        .handling(req => 'bard ' + req.path));

    return Promise.all([
      handler.handle(new http.Request('FOO', '/foo'))
        .should.eventually.eql('food /foo'),

      handler.handle(new http.Request('BAR', '/foo'))
        .should.eventually.eql('bard /foo'),
    ])
  });

  it('handles segment', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SegmentHandler()
        .beforeRequest(req => ({...req, foo: req.path}))
        .afterResponse(res => 'Hello ' + res)
        .handling(req => req.foo + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.eventually.eql('Hello / from '),

      handler.handle(new http.Request('GET', '/foo'))
        .should.eventually.eql('Hello / from foo'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.eventually.eql('Hello /bar from foo'),
    ])
  });

  it('matches name of segment', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SegmentHandler()
        .matchingName('foo')
        .handling(req => 'Hello ' + req.path + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle [GET /]'),

      handler.handle(new http.Request('GET', '/foo'))
        .should.eventually.eql('Hello / from foo'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.eventually.eql('Hello /bar from foo'),
    ])
  });

  it('handles slug', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SlugHandler()
        .beforeRequest(req => ({...req, foo: req.path}))
        .afterResponse(res => 'Hello ' + res)
        .handling(req => req.foo + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.eventually.eql('Hello / from '),

      handler.handle(new http.Request('GET', '/foo'))
        .should.eventually.eql('Hello / from foo'),

      handler.handle(new http.Request('GET', '/bar'))
        .should.eventually.eql('Hello / from bar'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle [GET /foo/bar]')
    ])
  });

  it('matches name of slug', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SlugHandler()
        .matchingName('foo')
        .handling(req => 'Hello ' + req.path));

    return Promise.all([
      handler.handle(new http.Request('GET', '/foo'))
        .should.eventually.eql('Hello /'),

      handler.handle(new http.Request('GET', '/bar'))
        .should.be.rejectedWith('Cannot handle [GET /bar]'),

      handler.handle(new http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle [GET /]'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle [GET /foo/bar]')
    ])
  });

  it('routes through handler tree', () => {
    let handler = new http.RequestHandler()

      .handling(new http.SegmentHandler()
        .matchingName('foo')

        .handling(new http.SlugHandler()
          .matchingMethod('get')
          .handling(req => 'got foo'))

        .handling(new http.SlugHandler()
          .matchingMethod('post')
          .handling(req => 'posted foo'))

        .handling(new http.SegmentHandler()
          .beforeRequest(req => ({...req, foo: req.segment}))
          .afterResponse(res => 'finally ' + res)

          .handling(new http.SlugHandler()
            .matchingName('this')
            .matchingMethod('get')
            .handling(req => 'got this of ' + req.foo))

          .handling(new http.SlugHandler()
            .matchingName('that')
            .handling(req => 'got that of ' + req.foo))))

      .handling(() => 'got none');

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.eventually.eql('got none'),

      handler.handle(new http.Request('GET', '/foo'))
        .should.eventually.eql('got foo'),

      handler.handle(new http.Request('POST', '/foo'))
        .should.eventually.eql('posted foo'),

      handler.handle(new http.Request('GET', '/foo/bar/this'))
        .should.eventually.eql('finally got this of bar'),

      handler.handle(new http.Request('POST', '/foo/bar/this'))
        .should.be.rejectedWith('Cannot handle [POST /this]'),

      handler.handle(new http.Request('ANY', '/foo/bar/that'))
        .should.eventually.eql('finally got that of bar'),
    ])
  });
});