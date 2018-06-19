const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const http = require('../../src/apis/http');
const message = require('../../src/message');

describe('Handling API requests', () => {

  it('wraps return value inside Response', () => {
    return new http.ApiHandler()
      .handling(() => ({foo: 'bar'}))

      .handle(new http.Request())
      .then(response => {
        response.statusCode.should.equal(200);
        response.body.should.eql({foo: 'bar'})
      })
  });

  it('generates a trace ID', () => {
    let traceId, i = 1;

    const handler = new http.ApiHandler({traceId: () => 'trace'  + i++})
      .handling(request => traceId = request.traceId);

    return handler.handle(new http.Request())
      .then(() => traceId.should.equal('trace1'))

      .then(() => handler.handle(new http.Request()))
      .then(() => traceId.should.equal('trace2'))
  });

  it('responds with error for unknown Error', () => {
    return new http.ApiHandler({traceId: () => 'trace'})
      .handling(() => {
        throw new Error('Nope')
      })

      .handle(new http.Request().withTraceId('trace'))
      .then(response => {
        response.statusCode.should.equal(500);
        response.body.should.eql({
          code: 'UNKNOWN_ERROR',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with error for a Rejection', () => {
    return new http.ApiHandler({traceId: () => 'trace'})
      .handling(() => {
        throw new message.Rejection('NOPE', 'Nope')
      })

      .handle(new http.Request().withTraceId('trace'))
      .then(response => {
        response.statusCode.should.equal(403);
        response.body.should.eql({
          code: 'NOPE',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with an error if request cannot be handled', () => {
    return new http.ApiHandler({traceId: () => 'trace'})

      .handle(new http.Request('GET', '/foo').withTraceId('trace'))
      .then(response => {
        response.statusCode.should.equal(404);
        response.body.should.eql({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Cannot handle [GET /foo]',
          traceId: 'trace'
        })
      })
  });
});
