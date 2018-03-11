class Request {
  constructor(method, path) {
    this.method = method;
    this.path = path;
  }
}

class RequestHandler {
  constructor() {
    this._befores = [];
    this._afters = [];
    this._handlers = [];
    this._errorHandlers = [];
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
    return true
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
  constructor(slugName) {
    super();
    this._name = slugName;
  }

  matches(request) {
    let path = request.path.split('/');
    return path.length == 2 && (!this._name || path[1] == this._name)
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
  constructor(segmentName) {
    super();
    this._name = segmentName;
  }

  matches(request) {
    let path = request.path.split('/');
    return path.length > 2 && (!this._name || path[1] == this._name)
  }

  handle(request) {
    return super.handle({
      ...request,
      path: '/' + request.path.split('/').slice(2).join('/'),
      segment: request.path.split('/')[1]
    })
  }
}

module.exports = {
  Request,
  RequestHandler,
  SlugHandler,
  SegmentHandler
};