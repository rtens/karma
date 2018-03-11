const k = require('../../src/karma');

module.exports = {
  execute: {
    name: 'an Aggregate',
    Unit: k.Aggregate,
    Message: k.Command,
    handling: 'executing',
    handle: 'execute',
  },
  respond: {
    name: 'a Projection',
    Unit: k.Projection,
    Message: k.Query,
    handling: 'respondingTo',
    handle: 'respondTo',
  },
  subscribe: {
    name: 'a subscribed Projection',
    Unit: k.Projection,
    Message: k.Query,
    handling: 'respondingTo',
    handle: 'subscribeTo',
  },
  react: {
    name: 'a Saga',
    Unit: k.Saga,
    Message: class extends k.Record {
      //noinspection JSUnusedGlobalSymbols
      constructor(name, payload) {
        super(new k.Event(name, payload))
      }
    },
    handling: 'reactingTo',
    handle: 'reactTo',
  }
};