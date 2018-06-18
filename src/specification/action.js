const event = require('../event');
const fake = require('./fakes');
const result = require('./result');

class Action {
  perform(example) {
  }
}

class RequestAction extends Action {
  constructor(method, route) {
    super();
    this.request = new fake.Request(method, route);
  }

  withUrlParameters(parameters) {
    this.request.params = parameters;
    return this
  }

  withQuery(query) {
    this.request.query = query;
    return this
  }

  perform(example) {
    return new result.RequestResult(example, this.request.execute(example.server))
  }
}

class GetRequestAction extends RequestAction {
  constructor(route) {
    super('get', route);
  }
}

class PostRequestAction extends RequestAction {
  constructor(route) {
    super('post', route);
  }

  withBody(body) {
    this.request.body = body;
    return this
  }
}

class PublishEventAction extends Action {
  constructor(event) {
    super();
    this.event = event;
  }

  perform(example) {
    const consumed = new event.Event('__record-consumed', {recordTime: 1});
    example.metaLog.records.push(new event.Record(consumed, 'Example'));

    const reaction = example.domain.start()
      .then(() => example.log.publish(new event.Record(this.event.event)));

    return new result.ReactionResult(example, reaction)
  }
}

module.exports = {
  get: path => new GetRequestAction(path),
  post: path => new PostRequestAction(path),
  publish: event => new PublishEventAction(event)
};