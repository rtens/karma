const message = require('../message');

class ApiHandler {
  constructor(app, options = {}) {
    this.app = app;
    this.generateTraceId = options.traceId || this._generateTraceId;
  }

  _generateTraceId() {
    return (Math.floor(Math.random() * 0x100000000) + 0x10000000).toString(16)
  }

  handle(request, response) {
    request.traceId = this.generateTraceId();

    return Promise.race([

      new Promise(y => response.on('end', () => y(response))),

      new Promise((y, n) => this.app.handle(request, response, err =>
        y(this._responseForError(err, request, response)))),
    ]);
  }

  _responseForError(err, request, response) {
    if (!err) {
      return response
        .status(404)
        .send(`Cannot ${request.method} ${request.url}`)
    }

    if (err instanceof message.Rejection) {
      return response
        .status(403)
        .send({
          code: err.code,
          message: err.message,
          traceId: request.traceId
        })
    }

    return response
      .status(500)
      .send({
        code: 'UNKNOWN_ERROR',
        message: err.message,
        traceId: request.traceId
      })
  }
}

module.exports = {
  ApiHandler
};