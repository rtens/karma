const expect = require('chai').expect;

class Expectation {
  assert(result) {
  }
}

class ResponseExpectation extends Expectation {
  constructor(body = null) {
    super();
    this.body = body;
    this.headers = {};
  }

  withHeaders(headers) {
    this.headers = headers;
    return this
  }

  assert(result) {
    expect(result.response.statusCode).to.equal(200, 'Unexpected response status');
    expect(result.response.body).to.eql(this.body, 'Unexpected response body');

    Object.keys(this.headers).forEach(header => {
      expect(result.response.headers).to.have.any.key(header);
      expect(result.response.headers[header]).to.equal(this.headers[header], `Unexpected value of header [${header}]`);
    })
  }
}

class RejectionExpectation extends Expectation {
  constructor(code) {
    super();
    this.code = code;
  }

  assert(result) {
    expect(result.response.statusCode).to.equal(403, 'Missing Rejection');
    expect(result.response.body.code).to.equal(this.code, 'Unexpected Rejection code');
  }
}

class ErrorExpectation extends Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    expect(result.errors).to.contain(this.message, 'Missing Error');
    result.errors.splice(result.errors.indexOf(this.message), 1);
  }
}

class NoErrorExpectation extends Expectation {

  assert(result) {
    //noinspection BadExpressionStatementJS
    expect(result.errors, 'Unexpected Error(s)').to.be.empty;
  }
}

module.exports = {
  Response: body => new ResponseExpectation(body),
  Rejection: code => new RejectionExpectation(code),
  Error: message => new ErrorExpectation(message),
  NoError: () => new NoErrorExpectation()
};