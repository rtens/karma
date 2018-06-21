const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../..');

describe('Handling HTTP requests', () => {

  it('fails if not handler matches', () => {
    return new k.api.http.RequestHandler()

      .handle(new k.api.http.Request('GET', '/foo'))
      .should.be.rejectedWith('Cannot handle [GET /foo]')
  });

  it('returns a response', () => {
    return new k.api.http.RequestHandler()
      .handling(req => new k.api.http.Response('Hello ' + req.path))

      .handle(new k.api.http.Request('GET', '/foo'))
      .should.eventually.eql(new k.api.http.Response('Hello /foo'))
  });

  it('wraps return value inside Response', () => {
    return new k.api.http.RequestHandler()
      .handling(req => ({foo: 'bar'}))

      .handle(new k.api.http.Request('GET', '/foo'))
      .should.eventually.eql(new k.api.http.Response({foo: 'bar'}))
  });

  it('receives payloads', () => {
    return new k.api.http.RequestHandler()
      .handling(req => req.body + req.query)

      .handle(new k.api.http.Request()
        .withBody('Foo')
        .withQuery('Bar'))
      .should.eventually.eql(new k.api.http.Response('FooBar'))
  });

  it('receives and sends status code and headers', () => {
    return new k.api.http.RequestHandler()
      .handling(req => new k.api.http.Response()
        .withStatus(123)
        .withHeader('Foo', 'bar')
        .withBody('Hello ' + req.headers.Name))

      .handle(new k.api.http.Request()
        .withHeader('Name', 'Foo'))
      .then(response => {
        response.statusCode.should.eql(123);
        response.headers.Foo.should.eql('bar');
        response.body.should.eql('Hello Foo')
      })
  });

  it('transforms the request before handling it', () => {
    return new k.api.http.RequestHandler()
      .beforeRequest(req => Promise.resolve(({foo: 'foo' + req.path})))
      .handling(req => 'Hello ' + req.foo)
      .beforeRequest(req => ({foo: req.foo + '/baz'}))

      .handle(new k.api.http.Request('GET', '/bar'))
      .should.eventually.eql(new k.api.http.Response('Hello foo/bar/baz'))
  });

  it('transforms the response before returning it', () => {
    return new k.api.http.RequestHandler()
      .afterResponse(res => Promise.resolve(new k.api.http.Response('Hello ' + res.body)))
      .handling(req => req.path)
      .afterResponse(res => new k.api.http.Response(res.body + '/baz'))

      .handle(new k.api.http.Request('GET', '/bar'))
      .should.eventually.eql(new k.api.http.Response('Hello /bar/baz'))
  });

  it('throws errors', () => {
    return new k.api.http.RequestHandler()
      .handling(new k.api.http.RequestHandler()
        .handling(() => {
          throw new Error('Nope')
        }))
      .handle(new k.api.http.Request())
      .should.be.rejectedWith(Error, 'Nope')
  });

  it('catches errors', () => {
    return new k.api.http.RequestHandler()
      .handling(() => {
        throw new Error('Nope')
      })
      .catching((err, req) => req.method + req.path + ': ' + err.message)

      .handle(new k.api.http.Request('GET', '/foo'))
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

    return new k.api.http.RequestHandler()
      .handling(() => {
        throw new FooError('Nope')
      })
      .catchingError(BarError, () => 'Not caught here')
      .catchingError(FooError, err => err.foo)
      .catching(() => 'Neither caught here')

      .handle(new k.api.http.Request())
      .should.eventually.eql('Nope')
  });

  it('delegates request to next handler', () => {
    return new k.api.http.RequestHandler()
      .handling(new k.api.http.RequestHandler()
        .handling(req => 'Deep ' + req.path))

      .handle(new k.api.http.Request('GET', '/foo'))
      .should.eventually.eql(new k.api.http.Response('Deep /foo'))
  });

  it('delegates to matching handler', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.RequestHandler()
        .matching(req => req.body == 'foo')
        .handling(req => 'food'))
      .handling(new k.api.http.RequestHandler()
        .matching(req => req.body == 'bar')
        .handling(req => 'bard'));

    return Promise.all([
      handler.handle(new k.api.http.Request().withBody('foo'))
        .should.eventually.eql(new k.api.http.Response('food')),

      handler.handle(new k.api.http.Request().withBody('bar'))
        .should.eventually.eql(new k.api.http.Response('bard')),
    ])
  });

  it('matches request method', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.RequestHandler()
        .matchingMethod('Foo')
        .handling(req => 'food ' + req.path))
      .handling(new k.api.http.RequestHandler()
        .matchingMethod('baR')
        .handling(req => 'bard ' + req.path));

    return Promise.all([
      handler.handle(new k.api.http.Request('FOO', '/foo'))
        .should.eventually.eql(new k.api.http.Response('food /foo')),

      handler.handle(new k.api.http.Request('BAR', '/foo'))
        .should.eventually.eql(new k.api.http.Response('bard /foo')),
    ])
  });

  it('handles segment', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.SegmentHandler()
        .beforeRequest(req => ({...req, foo: req.path}))
        .afterResponse(res => new k.api.http.Response('Hello ' + res.body))
        .handling(req => req.foo + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new k.api.http.Request('GET', '/'))
        .should.eventually.eql(new k.api.http.Response('Hello / from ')),

      handler.handle(new k.api.http.Request('GET', '/foo'))
        .should.eventually.eql(new k.api.http.Response('Hello / from foo')),

      handler.handle(new k.api.http.Request('GET', '/foo/bar'))
        .should.eventually.eql(new k.api.http.Response('Hello /bar from foo')),
    ])
  });

  it('matches name of segment', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.SegmentHandler()
        .matchingName('foo')
        .handling(req => 'Hello ' + req.path + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new k.api.http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle [GET /]'),

      handler.handle(new k.api.http.Request('GET', '/foo'))
        .should.eventually.eql(new k.api.http.Response('Hello / from foo')),

      handler.handle(new k.api.http.Request('GET', '/foo/bar'))
        .should.eventually.eql(new k.api.http.Response('Hello /bar from foo')),
    ])
  });

  it('handles slug', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.SlugHandler()
        .beforeRequest(req => ({...req, foo: req.path}))
        .afterResponse(res => new k.api.http.Response('Hello ' + res.body))
        .handling(req => req.foo + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new k.api.http.Request('GET', '/'))
        .should.eventually.eql(new k.api.http.Response('Hello / from ')),

      handler.handle(new k.api.http.Request('GET', '/foo'))
        .should.eventually.eql(new k.api.http.Response('Hello / from foo')),

      handler.handle(new k.api.http.Request('GET', '/bar'))
        .should.eventually.eql(new k.api.http.Response('Hello / from bar')),

      handler.handle(new k.api.http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle [GET /foo/bar]')
    ])
  });

  it('matches name of slug', () => {
    let handler = new k.api.http.RequestHandler()
      .handling(new k.api.http.SlugHandler()
        .matchingName('foo')
        .handling(req => 'Hello ' + req.path));

    return Promise.all([
      handler.handle(new k.api.http.Request('GET', '/foo'))
        .should.eventually.eql(new k.api.http.Response('Hello /')),

      handler.handle(new k.api.http.Request('GET', '/bar'))
        .should.be.rejectedWith('Cannot handle [GET /bar]'),

      handler.handle(new k.api.http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle [GET /]'),

      handler.handle(new k.api.http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle [GET /foo/bar]')
    ])
  });

  it('routes through handler tree', () => {
    let handler = new k.api.http.RequestHandler()

      .handling(new k.api.http.SegmentHandler()
        .matchingName('foo')

        .handling(new k.api.http.SlugHandler()
          .matchingMethod('get')
          .handling(req => 'got foo'))

        .handling(new k.api.http.SlugHandler()
          .matchingMethod('post')
          .handling(req => 'posted foo'))

        .handling(new k.api.http.SegmentHandler()
          .beforeRequest(req => ({...req, foo: req.segment}))
          .afterResponse(res => new k.api.http.Response('finally ' + res.body))

          .handling(new k.api.http.SlugHandler()
            .matchingName('this')
            .matchingMethod('get')
            .handling(req => 'got this of ' + req.foo))

          .handling(new k.api.http.SlugHandler()
            .matchingName('that')
            .handling(req => 'got that of ' + req.foo))))

      .handling(() => 'got none');

    return Promise.all([
      handler.handle(new k.api.http.Request('GET', '/'))
        .should.eventually.eql(new k.api.http.Response('got none')),

      handler.handle(new k.api.http.Request('GET', '/foo'))
        .should.eventually.eql(new k.api.http.Response('got foo')),

      handler.handle(new k.api.http.Request('POST', '/foo'))
        .should.eventually.eql(new k.api.http.Response('posted foo')),

      handler.handle(new k.api.http.Request('GET', '/foo/bar/this'))
        .should.eventually.eql(new k.api.http.Response('finally got this of bar')),

      handler.handle(new k.api.http.Request('POST', '/foo/bar/this'))
        .should.be.rejectedWith('Cannot handle [POST /this]'),

      handler.handle(new k.api.http.Request('ANY', '/foo/bar/that'))
        .should.eventually.eql(new k.api.http.Response('finally got that of bar')),
    ])
  });
});