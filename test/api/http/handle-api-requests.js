const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../..');

describe.skip('Handling HTTP API requests', () => {

  it('generates a trace ID', () => {
    let traceId, i = 1;

    const handler = new k.api.http.ApiHandler({traceId: () => 'trace' + i++})
      .handling(request => traceId = request.traceId);

    return handler.handle(new k.api.http.Request())
      .then(() => traceId.should.equal('trace1'))

      .then(() => handler.handle(new k.api.http.Request()))
      .then(() => traceId.should.equal('trace2'))
  });

  it('responds with 500 for unknown Error', () => {
    return new k.api.http.ApiHandler({traceId: () => 'trace'})
      .handling(() => Promise.reject(new Error('Nope')))

      .handle(new k.api.http.Request())
      .then(response => {
        response.statusCode.should.equal(500);
        response.body.should.eql({
          code: 'UNKNOWN_ERROR',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with 403 for a Rejection', () => {
    return new k.api.http.ApiHandler({traceId: () => 'trace'})
      .handling(() => Promise.reject(new k.Rejection('NOPE', 'Nope')))

      .handle(new k.api.http.Request())
      .then(response => {
        response.statusCode.should.equal(403);
        response.body.should.eql({
          code: 'NOPE',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with 404 if request cannot be handled', () => {
    return new k.api.http.ApiHandler({traceId: () => 'trace'})

      .handle(new k.api.http.Request('foo', 'bar'))
      .then(response => {
        response.statusCode.should.equal(404);
        response.body.should.eql({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Cannot handle [foo bar]',
          traceId: 'trace'
        })
      })
  });
});
