const expect = require('chai').expect;

const specification = require('..');
const express = require('../../apis/express');
const logging = require('../logging');

const httpMocks = require('node-mocks-http');
const events = require('events');

class RequestAction extends specification.Action {
  constructor(method, route) {
    super();

    const request  = httpMocks.createRequest({
      method: method.toUpperCase(),
      url: route,
    });

    const response = httpMocks.createResponse({
      eventEmitter: events.EventEmitter
    });

    this.request = new express.Request(request, response);
  }

  withHeaders(headers) {
    this.request.request.headers = headers;
    return this
  }

  withQuery(query) {
    this.request.request.query = query;
    return this
  }

  perform(example) {
    return new RequestResult(example, example.handler.handle(this.request))
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
    this.request.request.body = body;
    return this
  }
}

class RequestResult extends specification.Result {
  constructor(example, response) {
    super(example, response.then(res => this.response = res));
  }

  //noinspection JSUnusedGlobalSymbols
  finalAssertion() {
    new logging.NoLoggedErrorExpectation().assert(this);
  }
}

class ResponseExpectation extends specification.Expectation {
  constructor(body = '') {
    super();
    this.body = body;
    this.headers = {};
    this.statusCode = 200;
  }

  withStatus(code) {
    this.statusCode = code;
    return this
  }

  withHeaders(headers) {
    this.headers = headers;
    return this
  }

  assert(result) {
    let body = result.response._getData();
    if (typeof this.body != 'string') {
      try {
        body = JSON.parse(body);
      } catch (ignored) {
      }
    }

    expect(body).to.eql(this.body, 'Unexpected response body');
    expect(result.response.statusCode).to.equal(this.statusCode, 'Unexpected response status');

    Object.keys(this.headers).forEach(header => {
      expect(result.response._headers, 'Missing header').to.have.any.key(header);
      expect(result.response._headers[header]).to.equal(this.headers[header], `Unexpected value of header [${header}]`);
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
    expect(result.response._getData().code).to.equal(this.code, 'Unexpected Rejection code');
  }
}

module.exports = {
  GetRequestAction,
  PostRequestAction,
  ResponseExpectation,
  RejectionExpectation
};