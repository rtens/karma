const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const _persistence = require('../src/persistence');
const _event = require('../src/event');

const fake = require('./../src/specification/fakes');
const k = require('..');

describe('Subscribing to a Query', () => {
  let Module;

  beforeEach(() => {
    Module = (args = {}) =>
      new k.Domain(
        args.name || 'Test',
        args.strategy || new k.UnitStrategy(),
        {
          eventLog: () => args.log || new fake.EventLog(),
          snapshotStore: () => args.snapshots || new fake.SnapshotStore(),
          eventStore: () => args.store || new fake.EventStore()
        },
        {
          eventLog: () => args.metaLog || new fake.EventLog(),
          snapshotStore: () => args.metaSnapshots || new fake.SnapshotStore(),
          eventStore: () => args.metaStore || new fake.EventStore()
        })
  });

  it('fails if no responder exists for that Query', () => {
    return Module()

      .subscribeTo(new k.Query('Foo'))

      .should.be.rejectedWith(Error, 'Cannot handle Query [Foo]')
  });

  it('sends a value', () => {
    let responses = [];

    return Module()

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', payload => 'foo' + payload))

      .subscribeTo(new k.Query('Foo', 'bar'), response => responses.push(response))

      .then(() => responses.should.eql(['foobar']))
  });

  it('sends the value again on updates', () => {
    let responses = [];

    let log = new fake.EventLog();

    let snapshots = new fake.SnapshotStore();
    snapshots.snapshots = [{
      key: 'Projection-One-foo',
      version: 'v1',
      snapshot: new _persistence.Snapshot(new Date(), {}, 'snap ')
    }];

    return Module({log, snapshots})

      .add(new k.Projection('One')
        .withVersion('v1')
        .initializing(function () {
          this.state = ''
        })
        .applying('food', function (payload) {
          this.state += payload
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.state
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(() => log.publish(new _event.Record(new k.Event('food', 'one'))))

      .then(() => new Promise(y => setTimeout(y, 0)))

      .then(() => responses.should.eql(['snap ', 'snap one']))
  });

  it('does not send value if Projection is not applying Event', () => {
    let responses = [];

    let log = new fake.EventLog();

    return Module({log})

      .add(new k.Projection('One')
        .initializing(function () {
          this.state = 'one'
        })
        .applying('food', function (payload) {
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.state
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(() => log.publish(new _event.Record(new k.Event('not food', 'two'))))

      .then(() => responses.should.eql(['one']))
  });

  it('sends value to multiple subscribers', () => {
    let responses = [];

    var module = Module();
    return module

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', () => 'foo'))

      .subscribeTo(new k.Query('Foo'), response => responses.push('a ' + response))

      .then(() => module.subscribeTo(new k.Query('Foo'), response => responses.push('b ' + response)))

      .then(() => responses.should.eql(['a foo', 'b foo']))
  });

  it('can be cancelled', () => {
    let responses = [];

    let log = new fake.EventLog();

    return Module({log})

      .add(new k.Projection('One')
        .initializing(function () {
          this.state = ''
        })
        .applying('food', function (payload) {
          this.state += payload
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.state
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(subscription => subscription.cancel('bar'))

      .then(() => log.publish(new _event.Record(new k.Event('food', 'one'))))

      .then(() => responses.should.eql(['']))
  });

  it('keeps the Projection subscribed even if removed', () => {
    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.unload()};

    let domain = Module({log, strategy});

    return domain

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo'), ()=>null)

      .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
  });

  it('un-subscribes projection if removed and all subscriptions are cancelled', () => {
    let log = new fake.EventLog();

    let strategy = {onAccess: unit => unit.unload()};

    let domain = Module({log, strategy});

    return domain

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo'), ()=>null)

      .then(subscription => subscription.cancel())

      .then(() => domain.subscribeTo(new k.Query('Foo'), ()=>null))

      .then(subscription => subscription.cancel())

      .then(() => log.subscriptions.map(s => s.active).should.eql([false, false]))
  });

  it('does not un-subscribes projection if not removed and all subscriptions are cancelled', () => {
    let log = new fake.EventLog();

    let domain = Module({log});

    return domain

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo'), ()=>null)

      .then(subscription => subscription.cancel())

      .then(() => domain.subscribeTo(new k.Query('Foo'), ()=>null))

      .then(subscription => subscription.cancel())

      .then(() => log.subscriptions.map(s => s.active).should.eql([true]))
  });
});