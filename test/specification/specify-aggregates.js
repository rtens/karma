const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Aggregates', () => {

  const Module = configure => class extends k.api.http.Module {
    buildDomain() {
      return super.buildDomain()
        .add(configure(new k.Aggregate('One'))
          .initializing(function () {
            this.state = {
              foo: 'bar',
              bar: 'foo'
            };
          })
          .executing('Foo', ()=>'foo', function () {
            return [
              new k.Event('food', {foo: this.state.foo}),
              new k.Event('bard', {bar: this.state.bar})
            ]
          }));
    }

    //noinspection JSUnusedGlobalSymbols
    buildHandler() {
      return new k.api.http.CommandHandler(this.domain, request =>
        new k.Command(request.path))
    }
  };

  it('asserts recorded Events with payloads', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.Response())

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('asserts recorded Events with names only', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.Response())

      .then(expect.EventStream('foo', [
        expect.Event('food').withAnyPayload(),
        expect.Event('bard').withAnyPayload()
      ]))
  });

  it('fails if the Command is rejected', () => {
    return new Example(Module(aggreagte => aggreagte
      .executing('Bar', ()=>'foo', () => {
        throw new k.Rejection('NOPE')
      })))

      .when(I.post('Bar'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.eql('Unexpected Rejection: ' +
          'expected [Rejection: NOPE] to not exist')
      })

      .then({assert: result => result.rejection = null})
  });

  it('uses recorded Events', () => {
    return new Example(Module(aggregate => aggregate
      .applying('bazd', function ({one, two}) {
        this.state[one] = two;
      })
      .applying('band', function ({uno, dos}) {
        this.state[uno] = dos;
      })
    ))

      .given(the.EventStream('foo', [
        the.Event('bazd', {one: 'foo', two: 'baz'}),
        the.Event('band', {uno: 'bar', dos: 'ban'}),
      ]))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'baz'}),
        expect.Event('bard', {bar: 'ban'})
      ]))
  });

  it('does not use recorded Events of other Stream', () => {
    return new Example(Module(aggregate => aggregate
      .applying('bazd', function ({one, two}) {
        this.state[one] = two;
      })
    ))

      .given(the.EventStream('not foo', [
        the.Event('bazd', {one: 'foo', two: 'baz'}),
      ]))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'bar'}),
        expect.Event('bard', {bar: 'foo'})
      ]))
  });

  it('fails if no stream was recorded', () => {
    return new Example(Module(aggreagte => aggreagte
      .executing('Bar', ()=>'foo', () => null)))

      .when(I.post())

      .then(expect.EventStream('foo', []))

      .promise.should.be.rejectedWith("Stream not recorded: " +
        "expected [] to include 'foo'")
  });

  it('fails no ID of expected Event stream does not match', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('not foo', []))

      .promise.should.be.rejectedWith("Stream not recorded: " +
        "expected [ 'foo' ] to include 'not foo'")
  });

  it('fails if expected Event was not recorded', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('not food')
      ]))

      .promise.should.be.rejectedWith("Event not recorded: " +
        "expected [ 'food', 'bard' ] to deeply equal [ 'not food' ]")
  });

  it('fails if unexpected Event was recorded', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', []))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ 'food', 'bard' ] to deeply equal []")
  });

  it('fails if expected do not match recorded Events', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.EventStream('foo', [
        expect.Event('food', {foo: 'not'}),
        expect.Event('bard', {bar: 'not'})
      ]))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ Array(2) ] to deeply equal [ Array(2) ]")
  });

  it('fails if Event is not expected inside Stream', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.Event())

      .promise.should.be.rejectedWith('Events must be expected in an EventStream')
  });

  it('asserts no recorded Events', () => {
    return new Example(Module(aggregate => aggregate
      .executing('Bar', ()=>'foo', ()=>null)))

      .when(I.post('Bar'))

      .then(expect.NoEvents())
  });

  it('fails if unexpected stream exists', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then(expect.NoEvents())

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ 'food', 'bard' ] to deeply equal []")
  });

  it('asserts Events recorded on difference streams', () => {
    return new Example(class extends k.Module {
      //noinspection JSUnusedGlobalSymbols
      buildDomain() {
        return super.buildDomain()
          .add(new k.Aggregate('One')
            .executing('Foo', $=>$.stream, $ => [
              new k.Event('food', $.foo),
            ]));
      }

      handle() {
        return Promise.resolve()
          .then(() => this.domain.execute(new k.Command('Foo', {stream: 'one', foo: 'bar'})))
          .then(() =>this.domain.execute(new k.Command('Foo', {stream: 'one', foo: 'baz'})))
          .then(() => this.domain.execute(new k.Command('Foo', {stream: 'two', foo: 'bar'})))
      }
    })

      .when(I.post())

      .then(expect.EventStream('one', [
        expect.Event('food', 'bar'),
        expect.Event('food', 'baz')
      ]))
      .then(expect.EventStream('two', [
        expect.Event('food', 'bar')
      ]))
  });

  it('fails if Events do not match on difference streams', () => {
    return new Example(class extends k.Module {
      //noinspection JSUnusedGlobalSymbols
      buildDomain() {
        return super.buildDomain()
          .add(new k.Aggregate('One')
            .executing('Foo', $=>$.stream, $ => [
              new k.Event('food', $.foo),
            ]));
      }

      handle() {
        return Promise.all([
          this.domain.execute(new k.Command('Foo', {stream: 'one', foo: 'bar'})),
          this.domain.execute(new k.Command('Foo', {stream: 'two', foo: 'bar'}))
        ])
      }
    })

      .when(I.post())

      .then(expect.EventStream('one', [
        expect.Event('food', 'baz'),
      ]))

      .promise.should.be.rejectedWith("Unexpected Events: " +
        "expected [ Array(1) ] to deeply equal [ Array(1) ]")
  });

  it('uses events recorded by the Aggregate', () => {
    let applied = [];

    const module = class extends k.Module {
      buildDomain() {
        return super.buildDomain()

          .add(new k.Aggregate('One')
            .applying('food', $ => applied.push($))
            .executing('Foo', ()=>'foo', () => [new k.Event('food', 'bar')])
            .executing('Bar', ()=>'foo', () => [new k.Event('done', applied)]))
      }

      handle() {
        return this.domain.execute(new k.Command('Foo'))
          .then(() => this.domain.execute(new k.Command('Bar')));
      }
    };

    return new Example(module)

      .when(I.post())

      .then(expect.EventStream('foo', [
        expect.Event('food', 'bar'),
        expect.Event('done', ['bar'])
      ]))
  });

  it('keeps event times consistent', () => {
    return new Example(Module(aggregate => aggregate))

      .when(I.post('Foo'))

      .then({assert: () => new Promise(y => setTimeout(y, 10))})

      .then({
        assert: result => expect.EventStream('foo', [
          expect.Event('food', {foo: 'bar'}),
          expect.Event('bard', {bar: 'foo'})
        ]).assert(result)
      })
  });

  it('controls event times', () => {
    let event;

    return new Example(class extends k.api.http.Module {
      buildDomain() {
        return super.buildDomain()
          .add(new k.Aggregate('One')
            .executing('Foo', ()=>'foo', () => [new k.Event('food')]));
      }

      handle() {
        return this.domain.execute(new k.Command('Foo'))
          .then(records => event = records[0].event)
      }
    })

      .given(the.Time('2013-12-11Z'))

      .when(I.post())

      .then({assert: () => chai.expect(event.time).to.eql(new Date('2013-12-11Z'))})
  });
});