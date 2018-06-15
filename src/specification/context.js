const event = require('../event');

class Context {
  configure(example) {
  }
}

class Event extends Context {
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

module.exports = {
  Event: (name, payload) => new Event(name, payload)
};