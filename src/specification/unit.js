const event = require('../event');
const specification = require('.');

class EventContext extends specification.Context {
  constructor(name, payload) {
    super();
    this.event = new event.Event(name, payload);
  }

  withTime(timeString) {
    this.event.time = new Date(timeString);
    return this
  }

  onStream(streamId) {
    this.streamId = streamId;
    return this
  }

  configure(example) {
    const sequence = example.log.records.length;
    const time = 0;

    example.log.records.push(new event.Record(this.event, example.domainName, this.streamId, sequence, null, time));
  }
}

class EventStreamContext extends specification.Context {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  configure(example) {
    this.events.forEach(e =>
      e.onStream(this.streamId).configure(example))
  }
}

module.exports = {
  EventContext,
  EventStreamContext
};