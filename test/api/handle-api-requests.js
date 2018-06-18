const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const http = require('../../src/api/http');
const message = require('../../src/message');

describe('Handling API requests', () => {

  it('responds with error for unknown Error', () => {
    return new http.ApiHandler()
      .handling(() => {
        throw new Error('Nope')
      })

      .handle(new http.Request().withTraceId('trace'))
      .then(response => {
        response.status.should.equal(500);
        response.body.should.eql({
          code: 'UNKNOWN_ERROR',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with error for a Rejection', () => {
    return new http.ApiHandler()
      .handling(() => {
        throw new message.Rejection('NOPE', 'Nope')
      })

      .handle(new http.Request().withTraceId('trace'))
      .then(response => {
        response.status.should.equal(403);
        response.body.should.eql({
          code: 'NOPE',
          message: 'Nope',
          traceId: 'trace'
        })
      })
  });

  it('responds with an error if request cannot be handled', () => {
    return new http.ApiHandler()

      .handle(new http.Request('GET', '/foo').withTraceId('trace'))
      .then(response => {
        response.status.should.equal(404);
        response.body.should.eql({
          code: 'RESOURCE_NOT_FOUND',
          message: 'Cannot handle [GET /foo]',
          traceId: 'trace'
        })
      })
  });
});
