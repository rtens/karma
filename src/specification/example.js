const unit = require('../unit');
const persistence = require('../persistence');
const domain = require('../domain');
const fake = require('./fakes');

class Example {
  constructor(module) {
    this._setUpDate();
    this._setUpErrorLogging();
    this._setupDomain();
    this._setupServer();

    module(this.domain, this.server);
  }

  _setUpDate() {
    this.time = '2011-12-13T14:15:16.789Z';
    const example = this;

    const _Date = Date;
    Date = function (time) {
      return new _Date(time || example.time);
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

    this.metaStore = new fake.EventStore();
    this.metaLog = new fake.EventLog();

    this.domain = new domain.Domain('Example',
      new unit.UnitStrategy(),
      {
        eventStore: () => this.store,
        eventLog: () => this.log,
        snapshotStore: () => new fake.SnapshotStore(),
      },
      {
        eventStore: () => this.metaStore,
        eventLog: () => this.metaLog,
        snapshotStore: () => new fake.SnapshotStore(),
      });
  }

  _setupServer() {
    this.server = new fake.Server();
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