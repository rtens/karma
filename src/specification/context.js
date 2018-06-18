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
    const sequence = example.log.records.length;
    const time = 0;

    example.log.records.push(new event.Record(this.event, null, sequence, null, time));
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

class ValueDependencyContext extends Context {
  constructor(key, value) {
    super();
    this.key = key;
    this.value = value;
  }

  configure(example) {
    let object = example.dependencies;
    let keys = this.key.split('.');

    this.putDependency(example, object, keys, []);
  }

  putDependency(example, object, keys, myKeys) {
    let key = keys.shift();
    myKeys = [...myKeys, key];

    if (!key.endsWith('()')) {
      object[key] = this.dependency(example, keys, myKeys);
      return object;
    }

    let stub = new StubDependencyContext(myKeys.join('.'))
      .returning(this.dependency(example, keys, myKeys));

    example.stubs[stub.key] = stub;
    object[key.substr(0, key.length - 2)] = stub.value;
    return object;
  }

  dependency(example, keys, myKeys) {
    if (!keys.length) return this.value;
    return this.putDependency(example, {}, keys, myKeys);
  }
}

class StubDependencyContext extends ValueDependencyContext {
  constructor(key) {
    super(key, function () {
      stub.invocations.push([...arguments]);
      return stub.callback.apply(null, arguments);
    });
    this.invocations = [];
    this.callback = () => null;
    const stub = this;
  }

  returning(value) {
    this.callback = () => value;
    return this
  }

  calling(callback) {
    this.callback = callback;
    return this
  }

  callingIndexed(callback) {
    const stub = this;
    this.callback = function () {
      return callback(stub.invocations.length - 1).apply(null, arguments);
    };
    return this
  }

  configure(example) {
    example.stubs[this.key] = this;
    return super.configure(example)
  }
}

module.exports = {
  EventStream: (streamId, events) => new EventStreamContext(streamId, events),
  Event: (name, payload) => new EventContext(name, payload),
  Value: (key, value) => new ValueDependencyContext(key, value),
  Stub: (key, value) => new StubDependencyContext(key, value)
};