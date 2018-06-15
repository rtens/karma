const event = require('../../src/event');
const domain = require('../../src/domain');
const message = require('../../src/message');
const aggregate = require('../../src/units/aggregate');
const projection = require('../../src/units/projection');
const saga = require('../../src/units/saga');

module.exports = {
  execute: {
    name: 'an Aggregate',
    Unit: aggregate.Aggregate,
    Message: message.Command,
    handling: 'executing',
    handle: 'execute',
  },
  respond: {
    name: 'a Projection',
    Unit: projection.Projection,
    Message: message.Query,
    handling: 'respondingTo',
    handle: 'respondTo',
  },
  subscribe: {
    name: 'a subscribed Projection',
    Unit: projection.Projection,
    Message: message.Query,
    handling: 'respondingTo',
    handle: 'subscribeTo',
  },
  react: {
    name: 'a Saga',
    Unit: saga.Saga,
    Message: class extends event.Record {
      //noinspection JSUnusedGlobalSymbols
      constructor(name, payload) {
        super(new event.Event(name, payload))
      }
    },
    handling: 'reactingTo',
    handle: 'reactTo',
  }
};