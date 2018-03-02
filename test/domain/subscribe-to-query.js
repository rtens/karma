const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const fake = require('./fakes');
const k = require('../../src/karma');

describe('Subscribing to a Query', () => {

  let Module = (deps = {}) =>
    new k.Module(
      deps.log || new k.EventLog(),
      deps.snapshots || new k.SnapshotStore(),
      deps.strategy || new k.RepositoryStrategy(),
      deps.store || new k.EventStore());

  it('fails if no responder exists for that Query', () => {
    (() => Module()

      .subscribeTo(new k.Query('Foo')))

      .should.throw(Error, 'Cannot handle [Foo]')
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

    return Module({log})

      .add(new k.Projection('One')
        .initializing(function () {
          this.foods = ''
        })
        .applying('food', function (payload) {
          this.foods += payload
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.foods
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(() => log.publish(new k.Record(new k.Event('food', 'one'))))

      .then(() => responses.should.eql(['', 'one']))
  });

  it('does not send value if state has not changed', () => {
    let responses = [];

    let log = new fake.EventLog();

    return Module({log})

      .add(new k.Projection('One')
        .initializing(function () {
          this.foods = 'one'
        })
        .applying('food', function (payload) {
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.foods
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(() => log.publish(new k.Record(new k.Event('food', 'two'))))

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
          this.foods = ''
        })
        .applying('food', function (payload) {
          this.foods += payload
        })
        .respondingTo('Foo', ()=>'foo', function () {
          return this.foods
        }))

      .subscribeTo(new k.Query('Foo'), response => responses.push(response))

      .then(subscription => subscription.cancel('bar'))

      .then(() => log.publish(new k.Record(new k.Event('food', 'one'))))

      .then(() => responses.should.eql(['']))
  });

  it('keeps the Projection loaded', () => {
    let log = new fake.EventLog();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit, repository) {
        repository.remove(unit);
      }
    })();

    let domain = Module({log, strategy});

    return domain

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo'), ()=>null)

      .then(() => domain.subscribeTo(new k.Query('Foo'), ()=>null))

      .then(subscription => subscription.cancel())

      .then(() => log.cancelled.should.eql([]))
  });

  it('unloads projection if all subscriptions are cancelled', () => {
    let log = new fake.EventLog();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit, repository) {
        repository.remove(unit);
      }
    })();

    let domain = Module({log, strategy});

    return domain

      .add(new k.Projection('One')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo'), ()=>null)

      .then(subscription => subscription.cancel())

      .then(() => domain.subscribeTo(new k.Query('Foo'), ()=>null))

      .then(subscription => subscription.cancel())

      .then(() => domain.respondTo(new k.Query('Foo')))

      .then(() => log.cancelled.should.eql([
        {subscriptionId: 'Projection-One-foo'}
      ]))
  });

  it('can take a Snapshot of the Projection', () => {
    let snapshots = new fake.SnapshotStore();

    let strategy = new (class extends k.RepositoryStrategy {
      //noinspection JSUnusedGlobalSymbols
      onAccess(unit) {
        unit.takeSnapshot();
      }
    })();

    return Module({snapshots, strategy})

      .add(new k.Projection('One')
        .withVersion('v1')
        .respondingTo('Foo', ()=>'foo', ()=>null))

      .subscribeTo(new k.Query('Foo', 'foo'))

      .then(() => snapshots.stored.should.eql([{
        key: 'Projection-One-foo',
        version: 'v1',
        snapshot: {heads: {}, state: {}}
      }]))
  });
});