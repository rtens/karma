const message = require('./message');

class Event extends message.Message {
  constructor(name, payload, time = new Date()) {
    super(name, payload);
    this.time = time;
  }
}

class Record {
  constructor(event, streamId, sequence, traceId, time = new Date()) {
    this.time = time;
    this.event = event;
    this.streamId = streamId;
    this.sequence = sequence;
    this.traceId = traceId;
  }
}

module.exports = {
  Event,
  Record
};