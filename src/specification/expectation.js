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

class ErrorExpectation extends Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    expect(result.example.errors).to.contain(this.message, 'Missing Error');
    result.example.errors.splice(result.example.errors.indexOf(this.message), 1);
  }
}

class NoErrorExpectation extends Expectation {

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

module.exports = {
  Response: body => new ResponseExpectation(body),
  Rejection: code => new RejectionExpectation(code),
  Error: message => new ErrorExpectation(message),
  NoError: () => new NoErrorExpectation(),
  EventStream: (streamId, events) => new EventStreamExpectation(streamId, events),
  Event: (name, payload) => new EventExpectation(name, payload)
};