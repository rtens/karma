const aggregate = require('./units/aggregate');
const projection = require('./units/projection');
const event = require('./event');

class ReactionLockAggregate extends aggregate.Aggregate {
  constructor() {
    super('ReactionLock');

    this

      .initializing(function () {
        this.state = {
          locked: {}
        };
      })

      .applying('__reaction-locked', function ({streamId, sequence}) {
        //noinspection JSUnusedAssignment
        this.state.locked[JSON.stringify({streamId, sequence})] = true;
      })

      .applying('__reaction-failed', function ({streamId, sequence}) {
        delete this.state.locked[JSON.stringify({streamId, sequence})];
      })

      .executing('lock-reaction', $=>$.sagaKey, function ({sagaKey, recordTime, streamId, sequence}) {
        if (this.state.locked[JSON.stringify({streamId, sequence})]) {
          throw new Error('Reaction locked');
        }
        return [new event.Event('__reaction-locked', {sagaKey, recordTime, streamId, sequence})]
      })

      .executing('mark-reaction-as-failed', $=>$.sagaKey, function ({sagaId, sagaKey, record, error}) {
        return [new event.Event('__reaction-failed', {sagaId, sagaKey, record, error})]
      });
  }
}

class DomainSubscriptionAggregate extends aggregate.Aggregate {
  constructor() {
    super('DomainSubscription');

    this

      .executing('consume-record', $=>`__Domain-${$.domainName}`, function ({recordTime}) {
        return [new event.Event('__record-consumed', {recordTime})]
      })
  }
}

class DomainSubscriptionProjection extends projection.Projection {
  constructor(domainName) {
    super('DomainSubscription');

    this

      .initializing(function () {
        this.state = {
          lastRecordTime: null
        };
      })

      .applying('__record-consumed', function ({recordTime}) {
        if (recordTime > new Date(this.state.lastRecordTime)) {
          this.state.lastRecordTime = recordTime.toISOString()
        }
      })

      .applying('__reaction-locked', function ({recordTime}) {
        if (recordTime > new Date(this.state.lastRecordTime)) {
          this.state.lastRecordTime = recordTime.toISOString()
        }
      })

      .respondingTo('last-record-time', $=>domainName, function () {
        return this.state.lastRecordTime ? new Date(this.state.lastRecordTime) : new Date()
      })
  }
}

module.exports = {
  ReactionLockAggregate,
  DomainSubscriptionAggregate,
  DomainSubscriptionProjection
};