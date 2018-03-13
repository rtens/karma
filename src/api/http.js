class Request {
  constructor(method, path) {
    this.headers = {};
    this.method = method;
    this.path = path;
    this.body = null;
    this.query = null;
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

  withTraceId(traceId) {
    this.traceId = traceId;
    return this
  }
}

class Response {
  constructor() {
    this.headers = {};
    this.status = 200;
    this.body = null;
  }

  withHeader(key, value) {
    this.headers[key] = value;
    return this
  }

  withStatus(status) {
    this.status = status;
    return this
  }

  withBody(body) {
    this.body = body;
    return this
  }
}

class Handler {
  handle(request) {
  }
}

class RequestHandler {
  constructor() {
    this._matchers = [];
    this._befores = [];
    this._afters = [];
    this._handlers = [];
    this._errorHandlers = [];
  }

  matchingMethod(method) {
    this._matchers.push(request => request.method.toLowerCase() == method.toLowerCase());
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
      return Promise.reject(new Error(`Cannot handle Request [${request.method} ${request.path}]`))
    }

    return this._resolveAll(this._befores.slice(), request)
      .then(request => handler.handle(request))
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

class SlugHandler extends RequestHandler {
  constructor() {
    super();
    this._matchers.push(request => request.path.split('/').length == 2);
  }

  matchingName(string) {
    this._matchers.push(request => request.path.split('/')[1] == string);
    return this
  }

  handle(request) {
    return super.handle({
      ...request,
      path: '',
      slug: request.path.split('/')[1]
    })
  }
}

class SegmentHandler extends RequestHandler {
  constructor() {
    super();
    this._matchers.push(request => request.path.split('/').length > 2);
  }

  matchingName(string) {
    this._matchers.push(request => request.path.split('/')[1] == string);
    return this
  }

  handle(request) {
    return super.handle({
      ...request,
      path: '/' + request.path.split('/').slice(2).join('/'),
      segment: request.path.split('/')[1]
    })
  }
}

class QueryHandler extends Handler {
  constructor(module, requestToQuery) {
    super();
    this._module = module;
    this._query = requestToQuery;
  }

  handle(request) {
    return this._module.respondTo(this._query(request))
  }
}

class CommandHandler extends Handler {
  constructor(module, requestToCommand) {
    super();
    this._module = module;
    this._command = requestToCommand;
  }

  respondingWith(requestToQuery) {
    this._query = requestToQuery;
    return this
  }

  handle(request) {
    return this._module.execute(this._command(request).withTraceId(request.traceId))
      .then(records => this._query ? this._module.respondTo(this._query(request).waitFor({
        [records[records.length - 1].streamId]: records[records.length - 1].sequence
      })) : null)
  }
}

module.exports = {
  Request,
  Response,
  RequestHandler,
  SlugHandler,
  SegmentHandler,
  QueryHandler,
  CommandHandler
};