const chai = require('chai');
chai.should();

const karma = require('../src/karma');
const fake = require('../src/fakes');

class Example {
  constructor(module) {
    this._setUpErrorLogging();

    module(this._setupDomain(), this._setupServer());
  }

  _setUpErrorLogging() {
    this.errors = [];
    console.error = message => this.errors.push(message);
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
    if (!Array.isArray(context)) context = [context];
    context.forEach(c => c.configure(this));
    return this
  }

  when(action) {
    return action.perform(this)
  }
}

class Context {
  configure(example) {
  }
}

class Event extends Context {
  constructor(name, payload) {
    super();
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

class Action {
  perform(example) {
  }
}

class RequestAction extends Action {
  constructor(method, route) {
    super();
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
    return new RequestResult(this.request.execute(example.server), example.errors)
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
  constructor(promise) {
    this.lastPromise = promise;
  }

  finalAssertion() {
  }

  then(expectation, reject) {
    let resolve = (typeof expectation != 'function')
      ? this._keepStack(expectation)
      : this._finishUp(expectation, reject);

    this.lastPromise = this.lastPromise.then(resolve, reject);
    return this
  }

  _keepStack(expectation) {
    let error = new Error();
    return () => {
      try {
        expectation.assert(this);
      } catch (err) {
        err.stack += error.stack;
        throw err;
      }
    }
  }

  _finishUp(resolve, reject) {
    return () => {
      try {
        this.finalAssertion();
        resolve()
      } catch (err) {
        reject(err)
      }
    }
  }
}

class RequestResult extends Result {
  constructor(response, errors) {
    super(response.then(res => this.response = res));
    this.errors = errors;
  }

  finalAssertion() {
    //noinspection BadExpressionStatementJS
    chai.expect(this.errors, 'Unexpected Error(s)').to.be.empty;
  }
}

class ResponseExpectation {
  constructor(body = null) {
    this.body = body;
    this.headers = {};
  }

  withHeaders(headers) {
    this.headers = headers;
    return this
  }

  assert(result) {
    result.response.statusCode.should.equal(200, 'Unexpected response status');
    chai.expect(result.response.body).to.eql(this.body, 'Unexpected response body');

    Object.keys(this.headers).forEach(header => {
      chai.expect(result.response.headers).to.have.any.key(header);
      result.response.headers[header].should.equal(this.headers[header], `Unexpected value of header [${header}]`);
    })
  }
}

class RejectionExpectation {
  constructor(code) {
    this.code = code;
  }

  assert(result) {
    result.response.statusCode.should.equal(403, 'Missing Rejection')
    && result.response.body.code.should.equal(this.code, 'Unexpected Rejection code')
  }
}

class ErrorExpectation {
  constructor(message) {
    this.message = message;
  }

  assert(result) {
    result.errors.should.contain(this.message, 'Missing Error');
    result.errors.splice(result.errors.indexOf(this.message), 1);
  }
}

class FakeServer {
  constructor() {
    this.handlers = {GET: {}, POST: {}};
  }

  get(route, handler) {
    this.handlers.GET[route] = handler
  }

  post(route, handler) {
    this.handlers.POST[route] = handler
  }

  use(route, handler) {
    this.get(route, handler);
    this.post(route, handler);
  }
}

class FakeRequest {
  constructor(method, route) {
    this.method = method.toUpperCase();
    this.route = route;
    this.params = {};
    this.query = {};
  }

  execute(server) {
    if (!server.handlers[this.method][this.route]) {
      return Promise.reject(new Error(`No handler for [${this.method.toUpperCase()} ${this.route}] registered`))
    }

    let response = new FakeResponse();
    return new Promise(y => y(server.handlers[this.method][this.route](this, response)))
      .then(() => response)
  }
}

class FakeResponse {
  constructor() {
    this.headers = {};
    this.statusCode = 200;
    this.body = null;
  }

  setHeader(field, value) {
    this.headers[field] = value;
  }

  //noinspection JSUnusedGlobalSymbols
  header(field, value) {
    this.setHeader(field, value);
  }

  set(field, value) {
    this.setHeader(field, value);
  }

  status(code) {
    this.statusCode = code;
    return this
  }

  send(body) {
    if (Buffer.isBuffer(body)) body = body.toString();
    this.body = body;

    try {
      this.body = JSON.parse(this.body);
    } catch (ignored) {
    }
  }

  end(body) {
    this.send(body)
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
    Rejection: code => new RejectionExpectation(code),
    Error: message => new ErrorExpectation(message)
  }
};