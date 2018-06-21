class Message {
  constructor(name, payload) {
    this.name = name;
    this.payload = payload;
  }
}

class Command extends Message {
  withTraceId(traceId) {
    this.traceId = traceId;
    return this
  }
}

class Query extends Message {
  waitFor(heads) {
    this.heads = heads;
    return this
  }
}

class Rejection extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
    this.name = 'Rejection';
  }
}

module.exports = {
  Message,
  Command,
  Query,
  Rejection
};