const message = require('../message');
const domain = require('../domain');
const express = require('express');

class ExpressApiHandler {
  constructor(app, options = {}) {
    this.app = app;
    this.generateTraceId = options.traceId || this._generateTraceId;
  }

  _generateTraceId() {
    return (Math.floor(Math.random() * 0xefffffff) + 0x10000000).toString(16)
  }

  handle(request, response, log) {
    request.traceId = this.generateTraceId();

    return Promise.race([

      new Promise(y => response.on('end', () => y(response))),

      new Promise((y, n) => this.app.handle(request, response, err =>
        y(this._responseForError(err, request, response, log)))),
    ]);
  }

  _responseForError(err, request, response, log) {
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

    log.error('ERROR', request.traceId, err);
    return response
      .status(500)
      .send({
        code: 'UNKNOWN_ERROR',
        message: err.message,
        traceId: request.traceId
      })
  }
}

class ExpressModule extends domain.Module {

  handle({request, response}) {
    return this.buildHandler(express()).handle(request, response, this.logger)
  }

  buildHandler(app) {
    return new ExpressApiHandler(app)
  }
}

module.exports = {
  ApiHandler: ExpressApiHandler,
  Module: ExpressModule
};