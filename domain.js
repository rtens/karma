let chai = require('chai');
let promised = require('chai-as-promised');

chai.use(promised);
chai.should();

let _Date = Date;
Date = function () {
  return new _Date('2011-12-13T14:15:16Z');
};

describe('Command execution', () => {

  it('fails if no executer is defined', () => {
    (() => {
      new Domain()

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot execute [Foo]')
  });

  it('fails if an executer is defined twice in the same Aggregate', () => {
    (() => {
      //noinspection JSUnusedLocalSymbols
      new Domain()

        .add(class One extends Aggregate {
        }
          .executing('Foo')
          .executing('Foo'))

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if an executer is defined twice across Aggregate', () => {
    (() => {
      //noinspection JSUnusedLocalSymbols
      new Domain()

        .add(class One extends Aggregate {
        }
          .executing('Foo'))

        .add(class extends Aggregate {
        }
          .executing('Foo'))

        .execute(new Command('Foo'));

    }).should.throw(Error, '[One] is already executing [Foo]')
  });

  it('fails if the Command cannot be mapped to an Aggregate', () => {
    (() => {
      new Domain()

        .add(class extends Aggregate {
        }
          .executing('Foo', ()=>null))

        .execute(new Command('Foo'))

    }).should.throw(Error, 'Cannot map [Foo]')
  });

  it('executes the Command', () => {
    let executed = [];

    return new Domain(new FakeEventBus())

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, command => {
          executed.push(command);
        }))

      .execute(new Command('Foo'))

      .then(() => {
        executed.should.eql([
          new Command('Foo')
        ])
      })
  });

  it('fails if the Command is rejected', () => {
    return new Domain()

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function () {
          throw new Error('Nope')
        }))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('publishes Events', () => {
    let bus = new FakeEventBus();

    return new Domain(bus)

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function (command) {
          this.record('food', command.payload);
          this.record('bard', 'two');
        }))

      .execute(new Command('Foo', 'one', 'trace'))

      .then(() => {
        bus.published.should.eql([{
          events: [
            new Event('food', 'one', new Date(), 'trace'),
            new Event('bard', 'two', new Date(), 'trace'),
          ],
          followOffset: 0
        }])
      })
  });

  it('fails if Events cannot be published', () => {
    let bus = new FakeEventBus();
    bus.publish = () => {
      throw new Error('Nope')
    };

    return new Domain(bus)

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function () {
        }))

      .execute(new Command('Foo'))

      .should.be.rejectedWith(Error, 'Nope')
  });

  it('retries publishing before giving up', () => {
    let bus = new FakeEventBus();
    let count = 0;
    bus.publish = () => {
      if (count++ < 3) throw new Error()
    };

    return new Domain(bus)

      .add(class extends Aggregate {
      }
        .executing('Foo', ()=>1, function () {
        }))

      .execute(new Command('Foo'))

      .then(() => count.should.equal(4))

      .should.not.be.rejected
  });

  it('reconstitutes an Aggregate from Events');

  it('reconstitutes an Aggregate from a Snapshot plus Events');

  it('uses the reconstituted Aggregate');

  it('can take a Snapshot and unload an Aggregate');

  it('can use singleton Aggregates');
});

class Domain {
  constructor(eventBus) {
    this._bus = eventBus;
    this._aggregates = new AggregateRepository()
  }

  add(unit) {
    this._aggregates.add(unit);
    return this
  }

  execute(command) {
    return this._executeAndPublish(this._aggregates
      .mapToInstance(command), command);
  }

  _executeAndPublish(aggregate, command, tries = 0) {
    return aggregate
      .execute(command)
      .then(events =>
        this._bus.publish(events, aggregate.offset))
      .catch(e => {
        if (tries > 3) throw e;
        return this._executeAndPublish(aggregate, command, tries + 1)
      });
  }
}

class Command {
  constructor(name, payload, traceId) {
    this.name = name;
    this.payload = payload;
    this.traceId = traceId;
  }
}

class Aggregate {
  constructor(definition) {
    this.definition = definition;
    this.offset = 0;
  }

  execute(command) {
    this.definition.mapToId(command);

    return new Promise(y => {
      let events = [];
      this.record = (eventName, payload) =>
        events.push(new Event(eventName, payload, new Date(), command.traceId));

      this.definition._executers[command.name].call(this, command);

      y(events)
    })
  }

  static mapToId(command) {
    var aggregateId = this._mappers[command.name](command);
    if (!aggregateId) {
      throw new Error(`Cannot map [${command.name}]`)
    }

    return aggregateId;
  }

  static executing(commandName, mapper, executer) {
    if (!this._executers) this._executers = {};
    if (!this._mappers) this._mappers = {};

    if (commandName in this._executers) {
      throw new Error(`[${this.name}] is already executing [${commandName}]`)
    }

    this._executers[commandName] = executer;
    this._mappers[commandName] = mapper;
    return this
  }
}

class AggregateRepository {
  constructor() {
    this._definitions = {};
  }

  add(definition) {
    Object.keys(definition._executers).forEach(cn => {
      if (cn in this._definitions) {
        throw new Error(`[${this._definitions[cn].name}] is already executing [${cn}]`)
      }

      this._definitions[cn] = definition;
    });
  }

  mapToInstance(command) {
    var definition = this._definitions[command.name];
    if (!definition) {
      throw new Error(`Cannot execute [${command.name}]`)
    }

    return new Aggregate(definition);
  }
}

class EventBus {
  publish(event, followOffset) {
  }
}

class FakeEventBus extends EventBus {
  constructor() {
    super();
    this.published = [];
  }

  publish(events, followOffset) {
    this.published.push({events, followOffset})
  }
}

class Event {
  constructor(name, payload, timestamp, traceId) {
    this.name = name;
    this.payload = payload;
    this.traceId = traceId;
  }
}