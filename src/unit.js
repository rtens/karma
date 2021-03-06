const crypto = require('crypto');
const persistence = require('./persistence');
const logging = require('./logging');
const _message = require('./message');

class Unit {
  constructor(name) {
    if (!name) {
      throw new Error('Please provide a name.');
    }

    this.name = name;
    this._version = null;
    this._initializers = [];
    this._consolidators = [];
    this._appliers = {};
    this._mappers = {};
  }

  //noinspection JSUnusedLocalSymbols
  canHandle(message) {
    return false
  }

  mapToId(message) {
    return this._mappers[message.name](message.payload);
  }

  initializing(initializer) {
    this._initializers.push(initializer);
    return this
  }

  consolidating(consolidator) {
    this._consolidators.push(consolidator);
    return this
  }

  applying(eventName, applier) {
    (this._appliers[eventName] = this._appliers[eventName] || []).push(applier);
    return this
  }

  get version() {
    return this._version = this._version || this._inferVersion();
  }

  withVersion(version) {
    this._version = version;
    return this
  }

  _inferVersion() {
    var fingerprint = JSON.stringify([
      Object.values(this._appliers).map(as => as.map(a => a.toString())),
      Object.values(this._initializers).map(i => i.toString())
    ]);

    return crypto.createHash('md5').update(fingerprint).digest('hex');
  }
}

class UnitInstance {
  constructor(domain, id, definition, log, snapshots, logger) {
    this.domain = domain;
    this.id = id;
    this.definition = definition;
    this.state = null;

    this._log = log;
    this._snapshots = snapshots;
    this._logger = logger;

    this._lastRecordTime = null;
    this._heads = {};
    this._subscription = null;

    this._loaded = false;
    this._loading = false;
    this._onLoad = [];
    this._onUnload = [];

    definition._initializers.forEach(i => i.call(this));
  }

  get key() {
    return [
      this.definition.constructor.name,
      this.definition.name,
      this.id
    ].join('-')
  }

  load() {
    if (this._loaded) return Promise.resolve(this);
    if (this._loading) return new Promise(y => this._onLoad.push(()=>y(this)));
    this._loading = true;

    return Promise.resolve()
      .then(() => this._loadSnapshot())
      .then(() => this._subscribeToLog())
      .then(() => this._consolidate())
      .then(() => this._finishLoading())
      .then(() => this);
  }

  _loadSnapshot() {
    return this._snapshots.fetch(this.domain, this.key, this.definition.version)
      .then(snapshot => {
        this._lastRecordTime = snapshot.lastRecordTime;
        this._heads = snapshot.heads;
        this.state = snapshot.state;
      })
      .catch(()=>null)
  }

  _subscribeToLog() {
    let filter = this._recordFilter();
    if (this._lastRecordTime) filter.after(this._timeWindow(this._lastRecordTime));

    return this._log.subscribe(filter, record => this.apply(record))
      .then(subscription => this._subscription = subscription)
  }

  _timeWindow(time) {
    return new Date(time.getTime() - 10000);
  }

  _consolidate() {
    this.definition._consolidators.forEach(fn=>fn.call(this));
  }

  _recordFilter() {
    return this._log.filter()
      .nameIn(Object.keys(this.definition._appliers));
  }

  _finishLoading() {
    this._loaded = true;

    this._onLoad.forEach(fn=>fn());
  }

  onUnload(fn) {
    this._onUnload.push(fn);
  }

  unload() {
    this._onUnload.forEach(fn=>fn());
    if (this._subscription) this._subscription.cancel();
  }

  takeSnapshot() {
    return this._snapshots.store(this.domain, this.key, this.definition.version,
      new persistence.Snapshot(this._lastRecordTime, this._heads, this.state));
  }

  apply(record) {
    this._lastRecordTime = record.time;

    let appliers = this.definition._appliers[record.event.name];
    if (!appliers) return;

    this._heads[record.domainName] = this._heads[record.domainName] || {};
    if (record.sequence <= this._heads[record.domainName][record.streamId]) return;

    try {
      appliers.forEach(applier => applier.call(this, record.event.payload, record));
      if (this._loaded) this._consolidate();
    } catch (err) {
      this.unload();
      throw err
    }

    this._heads[record.domainName][record.streamId] = record.sequence;
  }

  _unitLogger(traceId) {
    return {
      error: message => this._logger.error(this.key, traceId, message),
      info: message => this._logger.info(this.key, traceId, message),
      debug: message => this._logger.debug(this.key, traceId, message),
    }
  }
}

class UnitRepository {
  constructor(domain, log, snapshots, logger) {
    this.domain = domain;
    this._log = log;
    this._snapshots = snapshots;
    this._logger = logger;

    this._definitions = [];
    this._instances = {};
  }

  add(definition) {
    this._definitions.push(definition);
  }

  _getUnitsHandling(message) {
    return Promise.all(this._definitions
      .filter(d => d.canHandle(message))
      .map(unitDefinition => {
        let unitId = unitDefinition.mapToId(message);
        if (!unitId) {
          return Promise.reject(new _message.Rejection('CANNOT_MAP_MESSAGE', `Cannot map [${message.name}]`))
        }

        return this._getOrLoad(unitDefinition, unitId)
      }))
  }

  _getOrLoad(definition, unitId) {
    this._instances[definition.name] = this._instances[definition.name] || {};

    let instance = this._instances[definition.name][unitId];

    if (!instance) {
      instance = this._instances[definition.name][unitId] = this._createInstance(unitId, definition);
      instance.onUnload(() => delete this._instances[definition.name][unitId])
    }

    return instance.load()
  }

  _createInstance(unitId, definition) {
    return new UnitInstance(this.domain, unitId, definition, this._log, this._snapshots);
  }
}

class UnitStrategy {
  onAccess(unit) {
  }
}

module.exports = {
  Unit,
  UnitInstance,
  UnitRepository,
  UnitStrategy
};