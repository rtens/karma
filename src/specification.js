const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const querystring = require('querystring');

class Specification {

  constructor(module) {
    this.server = express();
    this.server.use(bodyParser.json());

    module(null, this.server);
  }

  whenGetting(path, query) {
    return new GetRequest(this.server, path, query)
  }

  whenPosting(path, query) {
    return new PostRequest(this.server, path, query)
  }
}

class Request {

  constructor(request) {
    this.request = request;
  }

  expectResponse(body) {
    return this.request
      .expect(200, body);
  }
}

class GetRequest extends Request {

  constructor(server, path, query) {
    super(request(server)
      .get(path + '?' + querystring.stringify(query)))
  }
}

class PostRequest extends Request {

  constructor(server, path, query) {
    super(request(server)
      .post(path + '?' + querystring.stringify(query)))
  }

  withBody(body) {
    return new Request(this.request.send(body))
  }
}

module.exports = Specification;