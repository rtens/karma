const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const querystring = require('querystring');

class Example {
  constructor(module) {
    this.server = express();
    this.server.use(bodyParser.json());

    module(null, this.server);
  }

  when(action) {
    return action.perform(this)
  }
}

class RequestAction {
  constructor(path) {
    this.url = path;
  }

  withQuery(query) {
    this.url += '?' + querystring.stringify(query);
    return this
  }

  perform(example) {
    return new Result(this._performRequest(request(example.server)))
  }
}

class GetAction extends RequestAction {

  _performRequest(req) {
    return req.get(this.url);
  }
}

class PostAction extends RequestAction {

  withBody(body) {
    this.body = body;
    return this
  }

  _performRequest(req) {
    return req.post(this.url)
      .send(this.body);
  }
}

class Result {
  constructor(response) {
    this.response = response;
  }

  then(expectation) {
    return expectation.assert(this);
  }
}

class ResponseExpectation {
  constructor(body) {
    this.body = body;
  }

  assert(result) {
    return result.response
      .expect(200, this.body)
  }
}

module.exports = {
  Example,
  I: {
    get: (path) => new GetAction(path),
    post: (path) => new PostAction(path)
  },
  expect: {
    Response: (body) => new ResponseExpectation(body)
  }
};