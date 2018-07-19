const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec')();

describe('Specifying Projections', () => {

  let Module = configure => class extends k.api.http.Module {
    //noinspection JSUnusedGlobalSymbols
    buildDomain() {
      return super.buildDomain()
        .add(configure(new k.Projection('foo'))
          .initializing(function () {
            this.state = [];
          })
          .respondingTo('Foo', ()=>'foo', function () {
            return this.state
          }));
    }

    //noinspection JSUnusedGlobalSymbols
    buildHandler() {
      return new k.api.http.QueryHandler(this.domain, request =>
        new k.Query(request.path))
    }
  };

  it('uses recorded Events', () => {
    return new Example(Module(projection => projection
      .applying('food', function ($) {
        this.state.push($)
      })))

      .given(the.Event('food', 'one'))
      .given(the.Event('food', 'two'))

      .when(I.get('Foo'))

      .then(expect.Response(['one', 'two']))
  });

  it('catches unresolved promises', () => {
    return new Example(Module(projection => projection
      .respondingTo('Bar', ()=>'foo', () => new Promise(() => null))))

      .when(I.get('Bar'))

      .should.be.rejectedWith('No Response')
  });

  it('uses time of recorded Events', () => {
    return new Example(Module(projection => projection
      .applying('food', function ($, record) {
        this.state.push(record.event.time.getDay())
      })))

      .given([
        the.Event('food').withTime('2011-12-13'),
        the.Event('food').withTime('2001-02-03')
      ])
      .given(the.Event('food').withTime('2013-12-11'))

      .when(I.get('Foo'))

      .then(expect.Response([2, 6, 3]))
  });

  it('fails if the Query is rejected', () => {
    return new Example(Module(projection => projection
      .respondingTo('Bar', ()=>'foo', function () {
        throw new k.Rejection('NOPE')
      })))

      .when(I.get('Bar'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.eql('Unexpected Rejection: ' +
          'expected [Rejection: NOPE] to not exist')
      })

      .then({assert: result => result.rejection = null})
  });

  it('uses events recorded by an Aggregate', () => {
    const applied = [];
    const module = class extends k.api.http.Module {
      //noinspection JSUnusedGlobalSymbols
      buildDomain() {
        return super.buildDomain()

          .add(new k.Aggregate('One')
            .executing('Foo', ()=>'foo', () => [new k.Event('food', 'bar')]))

          .add(new k.Projection('One')
            .applying('food', $ => applied.push($))
            .respondingTo('Bar', ()=>'bar', () => applied));
      }

      //noinspection JSUnusedGlobalSymbols
      buildHandler() {
        return new k.api.http.CommandHandler(this.domain, () => new k.Command('Foo'))
          .respondingWith(() => new k.Query('Bar'))
      }
    };

    return new Example(module)

      .when(I.get())

      .then(expect.Response(['bar']))
  })
});