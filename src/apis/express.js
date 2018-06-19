const api = require('../api');

class RequestHandler extends api.RequestHandler {
  constructor(app) {
    super();
    this.app = app;
  }

  handle(request) {
    return Promise.race([

      new Promise(y => request.response.on('end', () =>
        y(request.response))),

      new Promise(y => setTimeout(() =>
        y(request.response), 10)),

      new Promise(y => this.app.handle(request.request, request.response, () =>
        y(request.response.status(404).end()))),
    ])
  }
}

class Request extends api.Request {
  constructor(request, response) {
    super();
    this.request = request;
    this.response = response;
  }
}

module.exports = {
  RequestHandler,
  Request
};