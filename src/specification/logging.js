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
    expect(result.example.errors).to.eql([], 'Unexpected Error(s)');
  }
}

module.exports = {
  LoggedErrorExpectation,
  NoLoggedErrorExpectation
};