const expect = require('chai').expect;
const event = require('../event');
const logging = require('./logging');
const specification = require('.');

class PublishEventAction extends specification.Action {
  constructor(event) {
    super();
    this.event = event;
  }

  perform(example) {
    const consumed = new event.Event('__record-consumed', {recordTime: 1});
    example.metaLog.records.push(new event.Record(consumed, 'Example'));

    const reaction = example.domain.start()
      .then(() => example.log.publish(new event.Record(this.event.event)));

    return new ReactionResult(example, reaction)
  }
}

class ReactionResult extends specification.Result {

  //noinspection JSUnusedGlobalSymbols
  finalAssertion() {
    new logging.NoLoggedErrorExpectation().assert(this);
    this.example.metaStore.recorded
      .forEach(r => r.events
        .filter(e => e.name == '__reaction-failed')
        .forEach(e => {
          const error = new Error('Reaction failed: ' + e.payload.record.event.name);
          error.stack = e.payload.error;
          throw error
        }))
  }
}

class ReactionFailureExpectation extends specification.Expectation {
  constructor(message) {
    super();
    this.message = message;
  }

  assert(result) {
    const failures = result.example.metaStore.recorded
      .map(r => r.events
        .filter(e => e.name == '__reaction-failed')
        .map(e => {
          const message = e.payload.error.substr('Error: '.length,
            e.payload.error.indexOf("\n") - 'Error: '.length);
          if (message == this.message) e.name = 'expected:__reaction-failed';
          return message;
        }))
      .reduce((flat, errs) => [...flat, ...errs], []);

    expect(failures).to.contain(this.message, 'Missing reaction failure');
  }
}

module.exports = {
  PublishEventAction,
  ReactionFailureExpectation
};