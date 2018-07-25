const expect = require('chai').expect;

const specification = require('.');

class LoggedErrorExpectation extends specification.Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    let messages = result.example.errors.map(e=>e.message);
    try {
      expect(messages).to.contain(this.message, 'Missing Error');
    } catch (err) {
      err.stack += '\n\nLogged Errors: ' + result.example.errors.map(e=>e.stack).join('\n\n');
      throw err
    }
    result.example.errors.splice(messages.indexOf(this.message), 1);
  }
}

class NoLoggedErrorExpectation extends specification.Expectation {

  assert(result) {
    try {
      let messages = result.example.errors.map(e=>e.message);
      expect(messages).to.eql([], 'Unexpected Error(s)');
    } catch (err) {
      throw result.example.errors[0]
    }
  }
}

module.exports = {
  LoggedErrorExpectation,
  NoLoggedErrorExpectation
};