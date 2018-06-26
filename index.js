const domain = require('./src/domain');
const message = require('./src/message');
const unit = require('./src/unit');
const event = require('./src/event');
const persistence = require('./src/persistence');
const aggregate = require('./src/units/aggregate');
const projection = require('./src/units/projection');
const saga = require('./src/units/saga');
const express = require('./src/apis/express');
const http = require('./src/apis/http');
const logging = require('./src/logging');

module.exports = {
  Module: domain.Module,

  Domain: domain.Domain,
  Event: event.Event,

  Query: message.Query,
  Command: message.Command,
  Rejection: message.Rejection,

  Aggregate: aggregate.Aggregate,
  Projection: projection.Projection,
  Saga: saga.Saga,

  UnitStrategy: unit.UnitStrategy,
  PersistenceFactory: persistence.PersistenceFactory,
  CombinedEventLog: persistence.CombinedEventLog,

  logging,

  api: {
    http,
    express
  }
};