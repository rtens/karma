const message = require('../message');
const unit = require('../unit');

class Aggregate extends unit.Unit {
  constructor(name) {
    super(name);
    this._executers = {};
  }

  canHandle(command) {
    return command.name in this._executers;
  }

  executing(commandName, mapper, executer) {
    if (commandName in this._executers) {
      throw new Error(`[${this.name}] is already executing [${commandName}]`)
    }

    this._executers[commandName] = executer;
    this._mappers[commandName] = mapper;
    return this
  }
}

class AggregateInstance extends unit.UnitInstance {
  constructor(domain, id, definition, log, snapshots, logger, store) {
    super(domain, id, definition, log, snapshots, logger);
    this._store = store;
  }

  //noinspection JSUnusedGlobalSymbols
  _recordFilter() {
    return this._log.filter()
      .onStream(this.domain, this.id)
  }

  apply(record) {
    if (!(record.domainName == this.domain && record.streamId == this.id)) return;
    super.apply(record);
    this._heads = {[this.domain]: {[this.id]: record.sequence}};
  }

  execute(command) {
    return this._execute(command)
  }

  _execute(command, tries = 0) {

    return this._tryToExecute(command)
      .then(events => {
        if (!Array.isArray(events)) return [];
        this._heads[this.domain] = this._heads[this.domain] || {};
        return this._store.record(events, this.domain, this.id, this._heads[this.domain][this.id], command.traceId);
      })
      .catch(e => {
        if (tries >= 5) throw e;
        const delay = Math.round(10 + Math.random() * Math.pow(2, 1 + tries));
        return new Promise(y => setTimeout(() => y(this._execute(command, tries + 1)), delay))
      })
  }

  _tryToExecute(command) {
    try {
      return Promise.resolve(this.definition._executers[command.name]
        .call(this, command.payload, command, this._unitLogger(command.traceId)));
    } catch (err) {
      return Promise.reject(err)
    }
  }
}

class AggregateRepository extends unit.UnitRepository {
  constructor(domain, log, snapshots, logger, store) {
    super(domain, log, snapshots, logger);
    this._store = store;
  }

  getAggregateExecuting(command) {
    return this._getUnitsHandling(command)
      .then(instances => {

        if (instances.length == 0) {
          throw new message.Rejection('COMMAND_NOT_FOUND', `Cannot handle Command [${command.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Command [${command.name}]`)
        }

        return instances[0];
      })
  }

  //noinspection JSUnusedGlobalSymbols
  _createInstance(aggregateId, definition) {
    return new AggregateInstance(this.domain, aggregateId, definition, this._log, this._snapshots, this._logger, this._store);
  }
}

module.exports = {
  Aggregate,
  AggregateRepository
};