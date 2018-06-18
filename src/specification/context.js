const event = require('../event');

class Context {
  configure(example) {
  }
}

class EventContext extends Context {
  constructor(name, payload) {
    super();
    this.event = new event.Event(name, payload);
  }

  withTime(timeString) {
    this.event.time = new Date(timeString);
    return this
  }

  configure(example) {
    example.log.records.push(new event.Record(this.event));
  }
}

class EventStreamContext extends Context {
  constructor(streamId, events) {
    super();
    this.streamId = streamId;
    this.events = events;
  }

  configure(example) {
    this.events.forEach(e =>
      example.log.records.push(new event.Record(e.event, this.streamId)))
  }
}

module.exports = {
  EventStream: (streamId, events) => new EventStreamContext(streamId, events),
  Event: (name, payload) => new EventContext(name, payload)
};