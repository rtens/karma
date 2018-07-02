const message = require('../message');
const domain = require('../domain');

class Request {
  constructor(method, path) {
    this.headers = {};
    this.method = method;
    this.path = path;
    this.body = null;
    this.query = null;
  }

  withTraceId(traceId) {
    this.traceId = traceId;
    return this
  }

  withHeader(key, value) {
    this.headers[key] = value;
    return this
  }

  withBody(body) {
    this.body = body;
    return this
  }

  withQuery(query) {
    this.query = query;
    return this
  }
}

class Response {
  constructor(body = null) {
    this.statusCode = 200;
    this.headers = {};
    this.body = body;
  }

  withStatus(code) {
    this.statusCode = code;
    return this
  }

  withHeader(key, value) {
    this.headers[key] = value;
    return this
  }

  withBody(body) {
    this.body = body;
    return this
  }
}

class NotFoundError extends Error {
  constructor(request) {
    super(`Cannot handle [${request.method} ${request.path}]`);
  }
}

class Handler {
  //noinspection JSUnusedLocalSymbols
  matches(request) {
    return true
  }

  handle(request) {
    return Promise.resolve();
  }
}

class RequestHandler extends Handler {
  constructor() {
    super();
    this._matchers = [];
    this._befores = [];
    this._afters = [];
    this._handlers = [];
    this._errorHandlers = [];
  }

  matchingMethod(method) {
    return this.matching(request => request.method.toLowerCase() == method.toLowerCase());
  }

  matching(requestMatcher) {
    this._matchers.push(requestMatcher);
    return this
  }

  beforeRequest(transformer) {
    this._befores.push(transformer);
    return this
  }

  afterResponse(transformer) {
    this._afters.push(transformer);
    return this
  }

  handling(withHandler) {
    if (typeof withHandler == 'function') {
      this._handlers.push({matches: ()=>true, handle: withHandler});
    } else {
      this._handlers.push(withHandler);
    }
    return this
  }

  catching(errorHandler) {
    this._errorHandlers.push({matches: ()=>true, handle: errorHandler});
    return this
  }

  catchingError(type, errorHandler) {
    this._errorHandlers.push({matches: err=>(err instanceof type), handle: errorHandler});
    return this
  }

  matches(request) {
    return this._matchers.every(m=>m(request))
  }

  handle(request) {
    let handler = this._handlers.find(h=>h.matches(request));

    if (!handler) {
      return Promise.reject(new NotFoundError(request))
    }

    return this._resolveAll(this._befores.slice(), request)
      .then(request => handler.handle(request))
      .then(response => response instanceof Response ? response : new Response(response))
      .then(response => this._resolveAll(this._afters.slice(), response))
      .catch(err => {
        let handler = this._errorHandlers.find(h=>h.matches(err));
        if (!handler) throw err;
        return handler.handle(err, request)
      })
  }

  _resolveAll(resolvers, object) {
    if (!resolvers.length) return Promise.resolve(object);
    return Promise.resolve(resolvers.shift()(object))
      .then(object => this._resolveAll(resolvers, object))
  }
}

class SegmentHandler extends RequestHandler {
  matchingName(string) {
    return this.matching(request => request.path.split('/')[1] == string)
  }

  handle(request) {
    return super.handle({
      ...request,
      path: '/' + request.path.split('/').slice(2).join('/'),
      segment: request.path.split('/')[1]
    })
  }
}

class SlugHandler extends SegmentHandler {
  constructor() {
    super();
    this.matching(request => request.path.split('/').length == 2)
  }
}

class HttpApiHandler extends RequestHandler {

  constructor(options = {}) {
    super();
    this.generateTraceId = options.traceId || this._generateTraceId;
  }

  _generateTraceId() {
    return (Math.floor(Math.random() * 0xefffffff) + 0x10000000).toString(16)
  }

  handle(request, log) {
    return super.handle(request.withTraceId(this.generateTraceId()))

      .catch(err => {

        if (err.constructor.name == NotFoundError.name)
          return new Response()
            .withStatus(404)
            .withBody({
              code: 'RESOURCE_NOT_FOUND',
              message: err.message,
              traceId: request.traceId
            });

        if (err.constructor.name == message.Rejection.name)
          return new Response()
            .withStatus(403)
            .withBody({
              code: err.code,
              message: err.message,
              traceId: request.traceId
            });

        log.error('ERROR', request.traceId, err);
        return new Response()
          .withStatus(500)
          .withBody({
            code: 'UNKNOWN_ERROR',
            message: err.message,
            traceId: request.traceId
          })
      })
  }
}

class QueryHandler extends Handler {
  constructor(domain, requestToQuery) {
    super();
    this._domain = domain;
    this._query = requestToQuery;
  }

  handle(request) {
    return this._domain.respondTo(this._query(request).withTraceId(request.traceId))
      .then(response => response instanceof Response ? response : new Response(response))
  }
}

class CommandHandler extends Handler {
  constructor(domain, requestToCommand) {
    super();
    this._domain = domain;
    this._command = requestToCommand;
  }

  respondingWith(requestToQuery) {
    this._query = requestToQuery;
    return this
  }

  handle(request) {
    return this._domain.execute(this._command(request).withTraceId(request.traceId))
      .then(records => this._query
        ? this._waitForResponse(records, this._query(request))
        : new Response())
  }

  _waitForResponse(records, query) {
    const lastRecord = records[records.length - 1];
    const heads = {[lastRecord.streamId]: lastRecord.sequence};

    return this._domain.respondTo(query.waitFor(heads))
  }
}

class HttpModule extends domain.Module {

  buildHandler() {
    return new HttpApiHandler()
  }

  handle(request) {
    return this.buildHandler().handle(request, this.logger)
  }
}

module.exports = {
  Request,
  Response,
  RequestHandler,
  SlugHandler,
  SegmentHandler,
  QueryHandler,
  CommandHandler,
  NotFoundError,
  ApiHandler: HttpApiHandler,
  Module: HttpModule
};