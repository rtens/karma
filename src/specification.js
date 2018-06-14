const express = require('express');
const bodyParser = require('body-parser');
const request = require('supertest');
const querystring = require('querystring');
const karma = require('../src/karma');
const fake = require('../src/fakes');

class Example {
  constructor(module) {
    module(this._setupDomain(), this._setupServer());
  }

  _setupDomain() {
    this.store = new fake.EventStore();
    this.log = new fake.EventLog();

    return new karma.Module('Test',
      new karma.UnitStrategy(),
      {
        eventStore: () => this.store,
        eventLog: () => this.log,
        snapshotStore: () => new karma.SnapshotStore(),
      },
      new karma.PersistenceFactory());
  }

  _setupServer() {
    this.server = express();
    this.server.use(bodyParser.json());

    return this.server
  }

  given(context) {
    context.configure(this);
    return this
  }

  givenAll(contexts) {
    contexts.forEach(context => this.given(context));
    return this
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

class Event {
  constructor(name, payload) {
    this.event = new karma.Event(name, payload);
  }

  withTime(timeString) {
    this.event.time = new Date(timeString);
    return this
  }

  configure(example) {
    example.log.records.push(new karma.Record(this.event));
  }
}

module.exports = {
  Example,
  the: {
    Event: (name, payload) => new Event(name, payload)
  },
  I: {
    get: (path) => new GetAction(path),
    post: (path) => new PostAction(path)
  },
  expect: {
    Response: (body) => new ResponseExpectation(body)
  }
};