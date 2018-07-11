const specification = require('./src/specification');
const aggregate = require('./src/specification/aggregate');
const dependency = require('./src/specification/dependency');
const logging = require('./src/specification/logging');
const unit = require('./src/specification/unit');
const saga = require('./src/specification/saga');

module.exports = (config = {}) => {
  let api = config.api || 'http';

  if (typeof api == 'string') {
    api = require('./src/specification/apis/' + api);
  }

  return {
    Example: specification.Example,
    the: {
      Time: timeString => new specification.TimeContext(timeString),
      EventStream: (streamId, events) => new unit.EventStreamContext(streamId, events),
      Event: (name, payload) => new unit.EventContext(name, payload),
      Value: (key, value) => new dependency.ValueDependencyContext(key, value),
      Stub: (key, value) => new dependency.StubDependencyContext(key, value)
    },
    I: {
      get: path => new api.GetRequestAction(path),
      post: path => new api.PostRequestAction(path),
      publish: event => new saga.PublishEventAction(event)
    },
    expect: {
      Response: body => new api.ResponseExpectation(body),
      Rejection: code => new api.RejectionExpectation(code),
      Failure: message => new saga.ReactionFailureExpectation(message),
      LoggedError: message => new logging.LoggedErrorExpectation(message),
      EventStream: (streamId, events) => new aggregate.EventStreamExpectation(streamId, events),
      Event: (name, payload) => new aggregate.EventExpectation(name, payload),
      NoEvents: () => new aggregate.NoEventsExpectation(),
      Invocations: stubKey => new dependency.InvocationsExpectation(stubKey),
      NoInvocations: stubKey => new dependency.NoInvocationsExpectation(stubKey),
      DelayedResult: waitMillis => new dependency.DelayedResultExpectation(waitMillis)
    }
  }
};