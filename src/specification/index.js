const karma = require('../karma');
const fake = require('./fakes');

class Example {
  constructor(module) {
    this._setUpErrorLogging();

    module(this._setupDomain(), this._setupServer());
  }

  _setUpErrorLogging() {
    this.errors = [];
    console.error = message => this.errors.push(message);
  }

  _setupDomain() {
    this.store = new fake.EventStore();
    this.log = new fake.EventLog();

    return new karma.Module('Test',
      new karma.UnitStrategy(),
      {
        eventStore: () => this.store,
        eventLog: () => this.log,
        snapshotStore: () => new karma.SnapshotStore(),
      },
      new karma.PersistenceFactory());
  }

  _setupServer() {
    this.server = new fake.Server();
    return this.server
  }

  given(context) {
    if (!Array.isArray(context)) context = [context];
    context.forEach(c => c.configure(this));
    return this
  }

  when(action) {
    return action.perform(this)
  }
}

module.exports = {
  Example,
  the: require('./context'),
  I: require('./action'),
  expect: require('./expectation')
};