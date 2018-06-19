class RequestHandler {
  //noinspection JSUnusedLocalSymbols
  matches(request) {
    return true
  }

  handle(request) {
    return Promise.resolve(new Response());
  }
}

class Request {
}

class Response {
}

module.exports = {
  RequestHandler,
  Request,
  Response
};