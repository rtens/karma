const unit = require('../unit');
const message = require('../message');

class Saga extends unit.Unit {
  constructor(name) {
    super(name);
    this._reactors = {};

    this.reactingTo('__reaction-retry-requested', $=>$.sagaId);
  }

  canHandle(event) {
    return event.name in this._reactors;
  }

  reactingTo(eventName, mapper, reactor) {
    if (eventName in this._reactors) {
      throw new Error(`Reaction to [${eventName}] is already defined in [${this.name}]`);
    }
    this._mappers[eventName] = mapper;
    this._reactors[eventName] = reactor;
    return this
  }
}

class SagaInstance extends unit.UnitInstance {
  constructor(id, definition, log, snapshots, logger, meta) {
    super(id, definition, log, snapshots, logger);
    this._meta = meta;
  }

  reactTo(record) {

    return this._lockReaction(record)
      .then(locked => locked ? this._tryToReactTo(record) : null)
  }

  _tryToReactTo(record) {
    let reactor = this.definition._reactors[record.event.name];

    return new Promise(y => y(reactor
      .call(this, record.event.payload, record, this._unitLogger(record.traceId))))

      .catch(err => {
        this._logger.error(this._key, record.traceId, err);
        return this._markReactionFailed(record, err.stack || err)
      })
  }

  _lockReaction(record) {
    return this._meta.execute(new message.Command('lock-reaction', {
      sagaKey: '__' + this._key,
      recordTime: record.time,
      streamId: record.streamId,
      sequence: record.sequence
    }))
      .then(() => true)
      .catch(() => {
        return false;
      })
  }

  _markReactionFailed(record, error) {
    return this._meta.execute(new message.Command('mark-reaction-as-failed', {
      sagaId: this.id,
      sagaKey: '__' + this._key,
      record,
      error
    }))
  }
}

class SagaRepository extends unit.UnitRepository {
  constructor(log, snapshots, logger, metaModule) {
    super(log, snapshots, logger);
    this._meta = metaModule;
  }

  getSagasReactingTo(event) {
    return this._getUnitsHandling(event);
  }

  //noinspection JSUnusedGlobalSymbols
  _createInstance(sagaId, definition) {
    return new SagaInstance(sagaId, definition, this._log, this._snapshots, this._logger, this._meta);
  }
}

module.exports = {
  Saga,
  SagaRepository
};