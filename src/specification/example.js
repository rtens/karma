const unit = require('../unit');
const persistence = require('../persistence');
const domain = require('../domain');
const fake = require('./fakes');

class Example {
  constructor(module) {
    this.module = module;

    this._setUpDate();
    this._setUpErrorLogging();
    this._setUpDependencies();
    this._setUpDomain();
    this._setUpServer();
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

  _setUpDomain() {
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

  _setUpServer() {
    this.server = new fake.Server();
  }

  _setUpDependencies() {
    this.dependencies = {};
    this.stubs = {};
  }

  given(context) {
    if (!Array.isArray(context)) context = [context];
    context.forEach(c => c.configure(this));
    return this
  }

  when(action) {
    this.module(this.domain, this.server, this.dependencies);

    return action.perform(this)
  }
}

module.exports = {
  Example
};