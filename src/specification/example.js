const unit = require('../unit');
const persistence = require('../persistence');
const domain = require('../domain');
const fake = require('./fakes');

class Example {
  constructor(module) {
    this._setUpDate();
    this._setUpErrorLogging();

    module(this._setupDomain(), this._setupServer());
  }

  _setUpDate() {
    this.time = '2020-06-10';

    const _Date = Date;
    Date = function (time) {
      return new _Date(time || this.time);
    };
    Date.now = () => new Date().getTime();
    Date.prototype = _Date.prototype;
  }

  _setUpErrorLogging() {
    this.errors = [];
    console.error = message => this.errors.push(message);
  }

  _setupDomain() {
    this.store = new fake.EventStore();
    this.log = new fake.EventLog();

    return new domain.Domain('Test',
      new unit.UnitStrategy(),
      {
        eventStore: () => this.store,
        eventLog: () => this.log,
        snapshotStore: () => new fake.SnapshotStore(),
      },
      new persistence.PersistenceFactory());
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
  Example
};