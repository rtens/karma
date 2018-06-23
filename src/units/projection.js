const message = require('../message');
const unit = require('../unit');

class Projection extends unit.Unit {
  constructor(name) {
    super(name);
    this._responders = {};
  }

  canHandle(query) {
    return query.name in this._responders;
  }

  respondingTo(queryName, mapper, responder) {
    if (queryName in this._responders) {
      throw new Error(`[${this.name}] is already responding to [${queryName}]`);
    }
    this._mappers[queryName] = mapper;
    this._responders[queryName] = responder;
    return this;
  }
}

class ProjectionInstance extends unit.UnitInstance {
  constructor(id, definition, log, snapshots, logger) {
    super(id, definition, log, snapshots, logger);
    this._waiters = [];
    this._unloaded = false;
  }

  respondTo(query) {
    return this._waitFor(query.heads)
      .then(() => this.definition._responders[query.name]
        .call(this, query.payload, query, this._unitLogger(query.traceId)))
  }

  _waitFor(heads) {
    return Promise.all(Object.keys(heads || {})
      .filter(streamId => (this._heads[streamId] || 0) < heads[streamId])
      .map(streamId => new Promise(y =>
        this._waiters.push({streamId, sequence: heads[streamId], resolve: y}))))
  }

  apply(record) {
    super.apply(record);

    this._waiters = this._waiters
      .filter(w => w.streamId != record.streamId || w.sequence != record.sequence || w.resolve())
  }

  unload() {
    if (this._waiters.length) return;
    super.unload()
  }
}

class ProjectionRepository extends unit.UnitRepository {
  getProjectionRespondingTo(query) {
    return this._getUnitsHandling(query)
      .then(instances => {

        if (instances.length == 0) {
          throw new message.Rejection('QUERY_NOT_FOUND', `Cannot handle Query [${query.name}]`)
        } else if (instances.length > 1) {
          throw new Error(`Too many handlers for Query [${query.name}]`)
        }

        return instances[0];
      })
  }

  //noinspection JSUnusedGlobalSymbols
  _createInstance(projectionId, definition) {
    return new ProjectionInstance(projectionId, definition, this._log, this._snapshots, this._logger);
  }
}

module.exports = {
  Projection,
  ProjectionInstance,
  ProjectionRepository
};