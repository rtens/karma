const expect = require('chai').expect;

const specification = require('.');

class EventStreamExpectation extends specification.Expectation {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  assert(result) {
    const streams = result.example.store.streams;

    expect(Object.keys(streams)).to.include(this.streamId,
      'Stream not recorded');
    expect(streams[this.streamId].map(e=>e.name)).to.eql(this.events.map(e=>e.name),
      this.events.length ? 'Event not recorded' : 'Unexpected Events');
    expect(this.transformed(streams[this.streamId])).to.eql(this.events,
      'Unexpected Events');
  }

  transformed(events) {
    return events.map((event, i) => this.events[i].transform(event))
  }
}

class EventExpectation extends specification.Expectation {
  constructor(name, payload) {
    super();
    this.name = name;
    this.payload = payload;
    this.time = new Date();
  }

  transform(actualEvent) {
    if (actualEvent.name == this.name && this.payload == undefined)
      return {
        name: actualEvent.name,
        payload: this.payload,
        time: actualEvent.time
      };

    return actualEvent;
  }

  //noinspection JSUnusedGlobalSymbols
  assert() {
    throw new Error('Events must be expected in an EventStream');
  }
}

class NoEventsExpectation extends specification.Expectation {

  assert(result) {
    const stream = result.example.store.recorded[0];
    const events = stream ? stream.events.map(e=>e.name) : [];
    expect(events).to.eql([], 'Unexpected Events');
  }
}

module.exports = {
  EventStreamExpectation,
  EventExpectation,
  NoEventsExpectation
};