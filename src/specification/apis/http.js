const expect = require('chai').expect;

const specification = require('..');
const http = require('../../apis/http');
const logging = require('../logging');

class RequestAction extends specification.Action {
  constructor(method, route) {
    super();
    this.request = new http.Request(method, route);
  }

  withHeaders(headers) {
    this.request.headers = headers;
    return this
  }

  withQuery(query) {
    this.request.query = query;
    return this
  }

  perform(example) {
    return new RequestResult(example, example.module.handle(this.request))
  }
}

class GetRequestAction extends RequestAction {
  constructor(route) {
    super('get', route);
  }
}

class PostRequestAction extends RequestAction {
  constructor(route) {
    super('post', route);
  }

  withBody(body) {
    this.request.body = body;
    return this
  }
}

class RequestResult extends specification.Result {
  constructor(example, response) {
    super(example, response
      .then(res => res.statusCode == 404
        ? Promise.reject(res.body)
        : this.response = res));
  }

  //noinspection JSUnusedGlobalSymbols
  finalAssertion() {
    new logging.NoLoggedErrorExpectation().assert(this);
  }
}

class ResponseExpectation extends specification.Expectation {
  constructor(body = null) {
    super();
    this.body = body;
    this.headers = {};
    this.statusCode = 200;
  }

  withHeaders(headers) {
    this.headers = headers;
    return this
  }

  withStatus(code) {
    this.statusCode = code;
    return this
  }

  withBody(body) {
    this.body = body;
    return this
  }

  assert(result) {
    if (this.body !== null) {
      expect(result.response.body).to.eql(this.body, 'Unexpected response body');
    }

    expect(result.response.statusCode).to.equal(this.statusCode, 'Unexpected response status');

    Object.keys(this.headers).forEach(header => {
      expect(result.response.headers, 'Missing header').to.have.any.key(header);
      expect(result.response.headers[header]).to.equal(this.headers[header], `Unexpected value of header [${header}]`);
    })
  }
}

class RejectionExpectation extends specification.Expectation {
  constructor(code) {
    super();
    this.code = code;
  }

  assert(result) {
    expect(result.response.statusCode).to.equal(403, 'Missing Rejection');
    expect(result.response.body.code).to.equal(this.code, 'Unexpected Rejection code');
  }
}

module.exports = {
  GetRequestAction,
  PostRequestAction,
  ResponseExpectation,
  RejectionExpectation
};