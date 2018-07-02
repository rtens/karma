const expect = require('chai').expect;

const specification = require('.');

class EventStreamExpectation extends specification.Expectation {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  assert(result) {
    const streams = result.example.store.recorded;

    expect(streams.map(s=>s.streamId)).to.include(this.streamId, 'Stream not recorded');

    let failed = streams.map(stream => {
      if (stream.streamId == this.streamId) {
        try {
          const eventNames = stream.events.map(e=>e.name);
          if (this.events.length == 0) {
            expect(eventNames).to.eql(this.events.map(e=>e.name), 'Unexpected Events');
          }
          expect(eventNames).to.eql(this.events.map(e=>e.name), 'Event not recorded');
          expect(this.transformed(stream.events)).to.eql(this.events, 'Unexpected Events');
          return null;
        } catch (err) {
          return err;
        }
      }
    });

    if (!failed.filter(x=>!x).length)
      throw failed.filter(x=>!!x)[0]
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