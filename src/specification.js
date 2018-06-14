const chai = require('chai');
chai.should();

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
    this.server = new FakeServer();
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

class FakeServer {
  constructor() {
    this.handlers = {get: {}, post: {}};
  }

  get(route, handler) {
    this.handlers.get[route] = handler
  }

  post(route, handler) {
    this.handlers.post[route] = handler
  }
}

class FakeRequest {
  constructor(method, route) {
    this.method = method;
    this.route = route;
    this.params = {};
    this.query = {};
  }

  execute(server) {
    if (!server.handlers[this.method][this.route]) {
      return Promise.reject(new Error(`No handler for [${this.route}] registered`))
    }

    let response = new FakeResponse();

    return (server.handlers[this.method][this.route](this, response) || Promise.resolve())
      .then(() => response)
  }
}

class FakeResponse {
  constructor() {
    this.statusCode = 200;
    this.body = null;
  }

  status(code) {
    this.statusCode = code;
    return this
  }

  send(body) {
    this.body = body
  }
}

class RequestAction {
  constructor(method, route) {
    this.request = new FakeRequest(method, route);
  }

  withUrlParameters(parameters) {
    this.request.params = parameters;
    return this
  }

  withQuery(query) {
    this.request.query = query;
    return this
  }

  perform(example) {
    return new Result(this.request.execute(example.server))
  }
}

class GetAction extends RequestAction {
  constructor(route) {
    super('get', route);
  }
}

class PostAction extends RequestAction {
  constructor(route) {
    super('post', route);
  }

  withBody(body) {
    this.request.body = body;
    return this
  }
}

class Result {
  constructor(response) {
    this.lastPromise = response.then(res => this.response = res);
  }

  then(expectation) {
    this.lastPromise = this.lastPromise.then(() => expectation.assert(this));
    return this
  }

  done() {
    return this.lastPromise
  }
}

class ResponseExpectation {
  constructor(body) {
    this.body = body;
  }

  assert(result) {
    return result.response.statusCode.should.equal(200, 'Unexpected response status')
      && chai.expect(result.response.body).to.eql(this.body, 'Unexpected response body')
  }
}

class RejectionExpectation {
  constructor(code) {
    this.code = code;
  }

  assert(result) {
    return result.response.statusCode.should.equal(403, 'Missing Rejection')
      && result.response.body.code.should.equal(this.code, 'Unexpected Rejection code')
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
    get: path => new GetAction(path),
    post: path => new PostAction(path)
  },
  expect: {
    Response: body => new ResponseExpectation(body),
    Rejection: code => new RejectionExpectation(code)
  }
};