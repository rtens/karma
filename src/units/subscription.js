const projection = require('./projection');

class SubscriptionInstance extends projection.ProjectionInstance {
  constructor(id, definition, log, snapshots, logger) {
    super(id, definition, log, snapshots, logger);
    this._subscriptions = [];
    this._unloaded = false;
  }

  subscribeTo(query, subscriber) {
    let subscription = {query, subscriber, active: true};

    return this.respondTo(query)
      .then(subscriber)
      .then(() => this._subscriptions.push(subscription))
      .then(() => ({
        cancel: () => {
          subscription.active = false;
          if (this._unloaded) this.unload()
        }
      }));
  }

  apply(record) {
    try {
      super.apply(record);

      if (this.definition._appliers[record.event.name]) {
        this._subscriptions
          .filter((subscription) => subscription.active)
          .forEach(({query, subscriber}) => this.respondTo(query).then(subscriber));
      }

    } catch (err) {
      this._subscriptions.forEach(s => s.active = false);
      this.unload();
      throw err
    }
  }

  unload() {
    this._unloaded = true;

    this._subscriptions = this._subscriptions.filter(s=>s.active);
    if (this._subscriptions.length) {
      return Promise.resolve()
    }
    super.unload()
  }
}

class SubscriptionRepository extends projection.ProjectionRepository {
  getSubscriptionRespondingTo(query) {
    return this.getProjectionRespondingTo(query)
  }

  //noinspection JSUnusedGlobalSymbols
  _createInstance(projectionId, definition) {
    return new SubscriptionInstance(projectionId, definition, this._log, this._snapshots, this._logger);
  }
}

module.exports = {
  SubscriptionRepository
};