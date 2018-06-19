const expect = require('chai').expect;

const specification = require('.');

class LoggedErrorExpectation extends specification.Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    expect(result.example.errors).to.contain(this.message, 'Missing Error');
    result.example.errors.splice(result.example.errors.indexOf(this.message), 1);
  }
}

class NoLoggedErrorExpectation extends specification.Expectation {

  assert(result) {
    //noinspection BadExpressionStatementJS
    expect(result.example.errors, 'Unexpected Error(s)').to.be.empty;
  }
}

module.exports = {
  LoggedErrorExpectation,
  NoLoggedErrorExpectation
};