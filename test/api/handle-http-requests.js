const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const http = require('../../src/api/http');

describe('Handling HTTP requests', () => {

  it('fails if not handler matches', () => {
    return new http.RequestHandler()

      .handle(new http.Request('GET', '/foo'))
      .should.be.rejectedWith('Cannot handle Request [GET /foo]')
  });

  it('returns a response', () => {
    return new http.RequestHandler()
      .handling(req => 'Hello ' + req.path)

      .handle(new http.Request('GET', '/foo'))
      .then(response => response.should.eql('Hello /foo'))
  });

  it('transforms the request before handling it', () => {
    return new http.RequestHandler()
      .beforeRequest(req => Promise.resolve(({foo: 'foo' + req.path})))
      .handling(req => 'Hello ' + req.foo)
      .beforeRequest(req => ({foo: req.foo + '/baz'}))

      .handle(new http.Request('GET', '/bar'))
      .then(response => response.should.eql('Hello foo/bar/baz'))
  });

  it('transforms the response before returning it', () => {
    return new http.RequestHandler()
      .afterResponse(res => Promise.resolve('Hello ' + res))
      .handling(req => req.path)
      .afterResponse(res => res + '/baz')

      .handle(new http.Request('GET', '/bar'))
      .then(response => response.should.eql('Hello /bar/baz'))
  });

  it('throws errors', () => {
    return new http.RequestHandler()
      .handling(() => {
        throw new Error('Nope')
      })

      .handle(new http.Request())
      .should.be.rejectedWith('Nope')
  });

  it('catches errors', () => {
    return new http.RequestHandler()
      .handling(() => {
        throw new Error('Nope')
      })
      .catching((err, req) => req.method + req.path + ': ' + err.message)

      .handle(new http.Request('GET', '/foo'))
      .then(response => response.should.eql('GET/foo: Nope'))
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
      .then(response => response.should.eql('Nope'))
  });

  it('delegates request to next handler', () => {
    return new http.RequestHandler()
      .handling(new http.RequestHandler()
        .handling(req => 'Deep ' + req.path))

      .handle(new http.Request('GET', '/foo'))
      .then(response => response.should.eql('Deep /foo'))
  });

  it('handles slug', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SlugHandler()
        .handling(req => 'Hello' + req.path + ' from ' + req.slug));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .then(response => response.should.eql('Hello from ')),

      handler.handle(new http.Request('GET', '/foo'))
        .then(response => response.should.eql('Hello from foo')),

      handler.handle(new http.Request('GET', '/bar'))
        .then(response => response.should.eql('Hello from bar')),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle Request [GET /foo/bar]')
    ])
  });

  it('handles matching slug', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SlugHandler('foo')
        .handling(req => 'Hello' + req.path));

    return Promise.all([
      handler.handle(new http.Request('GET', '/foo'))
        .then(response => response.should.eql('Hello')),

      handler.handle(new http.Request('GET', '/bar'))
        .should.be.rejectedWith('Cannot handle Request [GET /bar]'),

      handler.handle(new http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle Request [GET /]'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .should.be.rejectedWith('Cannot handle Request [GET /foo/bar]')
    ])
  });

  it('handles segment', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SegmentHandler()
        .handling(req => 'Hello ' + req.path + ' from ' + req.segment));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle Request [GET /]'),

      handler.handle(new http.Request('GET', '/foo'))
        .should.be.rejectedWith('Cannot handle Request [GET /foo]'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .then(response => response.should.eql('Hello /bar from foo')),
    ])
  });

  it('handles matching segment', () => {
    let handler = new http.RequestHandler()
      .handling(new http.SegmentHandler('foo')
        .handling(req => 'Hello ' + req.path));

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .should.be.rejectedWith('Cannot handle Request [GET /]'),

      handler.handle(new http.Request('GET', '/foo'))
        .should.be.rejectedWith('Cannot handle Request [GET /foo]'),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .then(response => response.should.eql('Hello /bar')),
    ])
  });

  it('routes through handler tree', () => {
    let handler = new http.RequestHandler()

      .handling(new http.SegmentHandler()
        .beforeRequest(req => ({...req, foo: req.segment}))
        .afterResponse(res => 'in ' + res)

        .handling(new http.SlugHandler('bar')
          .handling(req => 'three ' + req.foo))

        .handling(req => 'four ' + req.foo))

      .handling(new http.SlugHandler('foo')
        .handling(req => 'two'))

      .handling(req => 'one');

    return Promise.all([
      handler.handle(new http.Request('GET', '/'))
        .then(response => response.should.eql('one')),

      handler.handle(new http.Request('GET', '/foo'))
        .then(response => response.should.eql('two')),

      handler.handle(new http.Request('GET', '/foo/bar'))
        .then(response => response.should.eql('in three foo')),

      handler.handle(new http.Request('GET', '/bar/bar'))
        .then(response => response.should.eql('in three bar')),

      handler.handle(new http.Request('GET', '/bar/baz'))
        .then(response => response.should.eql('in four bar')),
    ])
  })
});