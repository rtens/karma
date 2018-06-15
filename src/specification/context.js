const karma = require('../karma');

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

module.exports = {
  Event: (name, payload) => new Event(name, payload)
};