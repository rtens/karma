const expect = require('chai').expect;

class Expectation {
  assert(result) {
  }
}

class ResponseExpectation extends Expectation {
  constructor(body = null) {
    super();
    this.body = body;
    this.headers = {};
  }

  withHeaders(headers) {
    this.headers = headers;
    return this
  }

  assert(result) {
    expect(result.response.body).to.eql(this.body, 'Unexpected response body');
    expect(result.response.statusCode).to.equal(200, 'Unexpected response status');

    Object.keys(this.headers).forEach(header => {
      expect(result.response.headers).to.have.any.key(header);
      expect(result.response.headers[header]).to.equal(this.headers[header], `Unexpected value of header [${header}]`);
    })
  }
}

class RejectionExpectation extends Expectation {
  constructor(code) {
    super();
    this.code = code;
  }

  assert(result) {
    expect(result.response.statusCode).to.equal(403, 'Missing Rejection');
    expect(result.response.body.code).to.equal(this.code, 'Unexpected Rejection code');
  }
}

class ReactionFailureExpectation extends Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    const failures = result.example.metaStore.recorded
      .map(r => r.events
        .filter(e => e.name == '__reaction-failed')
        .map(e => {
          const message = e.payload.error.substr('Error: '.length,
            e.payload.error.indexOf("\n") - 'Error: '.length);
          if (message == this.message) e.name = 'expected:__reaction-failed';
          return message;
        }))
      .reduce((flat, errs) => [...flat, ...errs], []);

    expect(failures).to.contain(this.message, 'Missing reaction failure');
  }
}

class LoggedErrorExpectation extends Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    expect(result.example.errors).to.contain(this.message, 'Missing Error');
    result.example.errors.splice(result.example.errors.indexOf(this.message), 1);
  }
}

class NoLoggedErrorExpectation extends Expectation {

  assert(result) {
    //noinspection BadExpressionStatementJS
    expect(result.example.errors, 'Unexpected Error(s)').to.be.empty;
  }
}

class EventStreamExpectation extends Expectation {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  assert(result) {
    const stream = result.example.store.recorded[0];
    expect(stream.streamId).to.equal(this.streamId, 'Unexpected Event stream ID');
    expect(stream.events.map(e=>e.name)).to.eql(this.events.map(e=>e.name), 'Event not recorded');
    expect(stream.events).to.eql(this.events, 'Unexpected Events');
  }
}

class EventExpectation extends Expectation {
  constructor(name, payload) {
    super();
    this.name = name;
    this.payload = payload;
    this.time = new Date();
  }

  assert() {
    throw new Error('Events must be expected in an EventStream');
  }
}

class InvocationsExpectation extends Expectation {
  constructor(stubKey) {
    super();
    this.key = stubKey;
    this.invocations = [];
  }

  withArguments() {
    this.invocations.push([...arguments]);
    return this
  }

  assert(result) {
    let invocations = result.example.stubs[this.key].invocations;

    //noinspection BadExpressionStatementJS
    expect(invocations, `Missing invocations of [${this.key}]`).to.not.be.empty;
    expect(invocations.length).to.equal(this.invocations.length, `Unexpected invocations of [${this.key}]`);
    this._assertArgumentCallbacks(invocations);
    expect(invocations).to.eql(this.invocations, `Unexpected invocations of [${this.key}]`);
  }

  _assertArgumentCallbacks(invocations) {
    this.invocations.forEach((invocation, i) =>
      invocation.forEach((argument, a) => {
        if (typeof argument == 'function') {
          try {
            argument(invocations[i][a]);
          } catch (err) {
            err.message = `Unexpected argument [${a}] in ` +
              `invocation [${i}] of [${this.key}]: ` + err.message;
            throw err;
          }
          this.invocations[i][a] = '*CALLBACK*';
          invocations[i][a] = '*CALLBACK*';
        }
      }));
  }
}

module.exports = {
  Response: body => new ResponseExpectation(body),
  Rejection: code => new RejectionExpectation(code),
  Failure: message => new ReactionFailureExpectation(message),
  LoggedError: message => new LoggedErrorExpectation(message),
  NoLoggedError: () => new NoLoggedErrorExpectation(),
  EventStream: (streamId, events) => new EventStreamExpectation(streamId, events),
  Event: (name, payload) => new EventExpectation(name, payload),
  Invocations: (stubKey) => new InvocationsExpectation(stubKey)
};