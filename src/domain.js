const message = require('./message');
const aggregate = require('./units/aggregate');
const projection = require('./units/projection');
const subscription = require('./units/subscription');
const saga = require('./units/saga');
const meta = require('./meta');

class BaseDomain {
  constructor(name, unitStrategy, persistenceFactory) {
    this._strategy = unitStrategy;

    this._log = persistenceFactory.eventLog(name);
    this._snapshots = persistenceFactory.snapshotStore(name);
    this._store = persistenceFactory.eventStore(name);

    this._aggregates = new aggregate.AggregateRepository(this._log, this._snapshots, this._store);
    this._projections = new projection.ProjectionRepository(this._log, this._snapshots);
    this._subscriptions = new subscription.SubscriptionRepository(this._log, this._snapshots);
  }

  add(unit) {
    if (unit instanceof aggregate.Aggregate) {
      this._aggregates.add(unit);
    } else if (unit instanceof projection.Projection) {
      this._projections.add(unit);
      this._subscriptions.add(unit);
    }

    return this
  }

  execute(command) {
    return this._aggregates
      .getAggregateExecuting(command)
      .then(this._notifyAccess(aggregate =>
        aggregate.execute(command)))
  }

  respondTo(query) {
    return this._projections
      .getProjectionRespondingTo(query)
      .then(this._notifyAccess(projection =>
        projection.respondTo(query)))
  }

  subscribeTo(query, subscriber) {
    return this._subscriptions
      .getSubscriptionRespondingTo(query)
      .then(this._notifyAccess(subscription =>
        subscription.subscribeTo(query, subscriber)))
  }

  _notifyAccess(handler) {
    return instance => handler(instance)
      .then(value => {
        this._strategy.onAccess(instance);
        return value
      })
      .catch(err => {
        this._strategy.onAccess(instance);
        return Promise.reject(err)
      })
  }
}

class Domain extends BaseDomain {
  constructor(name, unitStrategy, persistenceFactory, metaPersistenceFactory) {
    super(name, unitStrategy, persistenceFactory);
    this._name = name;

    this._adminLog = metaPersistenceFactory.eventLog('__admin');

    this._meta = new BaseDomain(name + '__meta', unitStrategy, metaPersistenceFactory);
    this._sagas = new saga.SagaRepository(this._log, this._snapshots, this._meta);

    this._meta._aggregates.add(new meta.ReactionLockAggregate());
    this._meta._aggregates.add(new meta.ModuleSubscriptionAggregate());
    this._meta._projections.add(new meta.ModuleSubscriptionProjection(name));
  }

  add(unit) {
    if (unit instanceof saga.Saga) {
      this._sagas.add(unit);
    } else {
      super.add(unit)
    }

    return this
  }

  start() {
    return this._meta.respondTo(new message.Query('last-record-time'))
      .then(lastRecordTime => {
        return Promise.all([
          this._log.subscribe(this._log.filter().after(lastRecordTime),
            record => this.reactTo(record)),
          this._adminLog.subscribe(this._adminLog.filter().after(lastRecordTime),
            record => this.reactToAdmin(record))
        ])
      })
      .then(() => this)
  }

  reactTo(record) {
    return this._sagas
      .getSagasReactingTo(record.event)
      .then(instances => instances.length
        ? Promise.all(instances.map(this._notifyAccess(instance => instance.reactTo(record))))
        : this._consumeRecord(record))
  }

  reactToAdmin(record) {
    if (record.event.name == '__reaction-retry-requested') {
      return this.reactTo(record.event.payload.record)
    }
  }

  _consumeRecord(record) {
    return this._meta.execute(new message.Command('consume-record', {
      moduleName: this._name,
      recordTime: record.time
    }));
  }
}

module.exports = {
  Domain,
};