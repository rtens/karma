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
    return new result.RequestResult(this.request.execute(example.server), example.errors)
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

module.exports = {
  get: path => new GetRequestAction(path),
  post: path => new PostRequestAction(path)
};