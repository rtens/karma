const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../../../index.js');
const {Example, I, expect} = require('../../../spec')({api: 'http'});

const express = require('express');

describe('Specifying an HTTP API', () => {

  const Module = configure => class extends k.api.http.Module {
    //noinspection JSUnusedGlobalSymbols
    buildHandler() {
      return configure(super.buildHandler(), this)
    }
  };

  it('fails if the Route of a GET request is not defined', () => {
    return new Example(Module(api => api))

      .when(I.get('/foo'))

      .promise.should.be.rejectedWith('Cannot handle [get /foo]')
  });

  it('fails if the response does not match', () => {
    return new Example(Module(api => api
      .handling(() => 'bar')))

      .when(I.get('/foo'))

      .then(expect.Response('baz'))

      .promise.should.be.rejectedWith("Unexpected response body: " +
        "expected 'bar' to deeply equal 'baz'");
  });

  it('fails if the response status does not match', () => {
    return new Example(Module(api => api
      .handling(() => new k.api.http.Response('bar').withStatus(201))))

      .when(I.get('/foo'))

      .then(expect.Response('bar')
        .withStatus(202))

      .promise.should.be.rejectedWith("Unexpected response status: " +
        "expected 201 to equal 202");
  });

  it('asserts the expected response', () => {
    return new Example(Module(api => api
      .handling(() => 'bar')))

      .when(I.get('/foo'))

      .then(expect.Response('bar'))
  });

  it('fails if an expected Rejection is missing', () => {
    return new Example(Module(api => api
      .handling(() => 'bar')))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .promise.should.be.rejectedWith('Missing Rejection: ' +
        'expected 200 to equal 403')
  });

  it('asserts an expected Rejection', () => {
    return new Example(Module(api => api
      .handling(() => Promise.reject(new k.Rejection('NOPE', 'Nope')))))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))
  });

  it('fails if the Rejection code does not match', () => {
    return new Example(Module(api => api
      .handling(() => Promise.reject(new k.Rejection('NOT_NOPE', 'Nope')))))

      .when(I.get('/foo'))

      .then(expect.Rejection('NOPE'))

      .promise.should.be.rejectedWith("Unexpected Rejection code: " +
        "expected 'NOT_NOPE' to equal 'NOPE'")
  });

  it('fails if an expected Error is not logged', () => {
    return new Example(Module((api, module) => api
      .handling(() => module.logger.error('foo', 'bar', new Error('Not Nope')))))

      .when(I.get('/foo'))

      .then(expect.LoggedError('Nope'))

      .promise.should.be.rejectedWith("Missing Error: " +
        "expected [ 'Not Nope' ] to include 'Nope'")

      .then({assert: result => result.errors.splice(0, 1)})
  });

  it('asserts a logged Error', () => {
    return new Example(Module((api, module) => api
      .handling(() => module.logger.error('foo', 'bar', new Error('Nope')))))

      .when(I.get('/foo'))

      .then(expect.LoggedError('Nope'))
  });

  it('fails if an unexpected Error is logged', () => {
    return new Example(Module((api, module) => api
      .handling(() => module.logger.error('foo', 'bar', new Error('Nope')))))

      .when(I.get('/foo'))

      .then(() => {
        throw new Error('Should have failed')
      }, err => {
        err.message.should.equal("Unexpected Error(s): " +
          "expected [ 'Nope' ] to be empty")
      })

      .then({assert: result => result.example.errors.splice(0, 1)})
  });

  it('uses headers and query arguments of GET request', () => {
    return new Example(Module(api => api
      .handling(req => `${req.query.greeting} ${req.headers.name}`)))

      .when(I.get('/greet')
        .withHeaders({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('fails if the Route of a POST request is not defined', () => {
    return new Example(Module(api => api))

      .when(I.post('/foo'))

      .promise.should.be.rejectedWith(k.api.NotFoundError, 'Cannot handle [post /foo]')
  });

  it('uses headers and query arguments of POST request', () => {
    return new Example(Module(api => api
      .handling(req => `${req.query.greeting} ${req.headers.name}`)))

      .when(I.post('/greet')
        .withHeaders({name: 'foo'})
        .withQuery({greeting: 'hello'}))

      .then(expect.Response('hello foo'))
  });

  it('uses body of POST request', () => {
    return new Example(Module(api => api
      .handling(req => `Hello ${req.body.name}`)))

      .when(I.post('/foo').withBody({name: 'bar'}))

      .then(expect.Response('Hello bar'))
  });

  it('fails if header is missing', () => {
    return new Example(Module(api => api
      .handling(() => null)))

      .when(I.get('/foo'))

      .then(expect.Response().withHeaders({not: 'set'}))

      .promise.should.be.rejectedWith("Missing header: " +
        "expected {} to have key 'not'")
  });

  it('fails if header value doe not match', () => {
    return new Example(Module(api => api
      .handling(() => new k.api.http.Response().withHeader('foo', 'bar'))))

      .when(I.get('/foo'))

      .then(expect.Response().withHeaders({foo: 'baz'}))

      .promise.should.be.rejectedWith("Unexpected value of header [foo]: " +
        "expected 'bar' to equal 'baz'")
  });

  it('asserts headers of response', () => {
    return new Example(Module(api => api
      .handling(() => new k.api.http.Response().withHeader('foo', 'bar'))))

      .when(I.get('/foo'))

      .then(expect.Response().withHeaders({foo: 'bar'}))
  });
});