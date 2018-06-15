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
  constructor(id, definition, log, snapshots, store) {
    super(id, definition, log, snapshots);
    this._store = store;
  }

  _recordFilter() {
    return this._log.filter()
      .ofStream(this.id)
  }

  apply(record) {
    if (record.streamId != this.id) return;
    super.apply(record);
    this._heads = {[this.id]: record.sequence};
  }

  execute(command) {
    // debug('execute', {command, id: this.id});
    try {
      return this._execute(command);
    } catch (err) {
      return Promise.reject(err)
    }
  }

  _execute(command, tries = 0) {
    let events = this.definition._executers[command.name].call(this, command.payload);

    if (!Array.isArray(events)) return Promise.resolve([]);

    // debug('record', {id: this.id, tries, sequence: this._heads[this.id], events});
    return this._store.record(events, this.id, this._heads[this.id], command.traceId)
      .catch(e => {
        if (tries >= 10) throw e;
        return new Promise(y => setTimeout(() => y(this._execute(command, tries + 1)),
          Math.round(10 + Math.random() * Math.pow(2, 1 + tries))))
      })
  }
}

class AggregateRepository extends unit.UnitRepository {
  constructor(log, snapshots, store) {
    super(log, snapshots);
    this._store = store;
  }

  getAggregateExecuting(command) {
    return this._getUnitsHandling(command)
      .then(instances => {

        if (instances.length == 0) {
          throw new Error(`Cannot handle Command [${command.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Command [${command.name}]`)
        }

        return instances[0];
      })
  }

  _createInstance(aggregateId, definition) {
    return new AggregateInstance(aggregateId, definition, this._log, this._snapshots, this._store);
  }
}

module.exports = {
  Aggregate,
  AggregateRepository
};