const expect = require('chai').expect;

const specification = require('.');

class EventStreamExpectation extends specification.Expectation {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  assert(result) {
    const stream = result.example.store.recorded[0];

    //noinspection BadExpressionStatementJS
    expect(stream, 'No streams recorded').to.exist;
    expect(stream.streamId).to.equal(this.streamId, 'Unexpected Event stream ID');
    expect(stream.events.map(e=>e.name)).to.eql(this.events.map(e=>e.name), 'Event not recorded');
    expect(stream.events).to.eql(this.events, 'Unexpected Events');
  }
}

class EventExpectation extends specification.Expectation {
  constructor(name, payload) {
    super();
    this.name = name;
    this.payload = payload;
    this.time = new Date();
  }

  //noinspection JSUnusedGlobalSymbols
  assert() {
    throw new Error('Events must be expected in an EventStream');
  }
}

module.exports = {
  EventStreamExpectation,
  EventExpectation
};