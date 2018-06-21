const express = require('express');
const httpMocks = require('node-mocks-http');
const events = require('events');

const expect = require('chai').expect;

const k = require('../../..');

describe('Handling express requests', () => {

  it('sends response body and status', () => {
    return new k.api.express.ApiHandler(express()
      .get('/foo', (req, res) => res.status(201).send('bar')))

      .handle(
        httpMocks.createRequest({method: 'GET', url: '/foo'}),
        httpMocks.createResponse({eventEmitter: events.EventEmitter}))

      .then(response => {
        expect(response.statusCode).to.equal(201);
        expect(response._getData()).to.equal('bar');
      })
  });

  it('generates a trace ID', () => {
    return new k.api.express.ApiHandler(express()
      .get('/foo', (req, res) => res.send(req.traceId)), {traceId: () => 'trace'})

      .handle(
        httpMocks.createRequest({method: 'GET', url: '/foo'}),
        httpMocks.createResponse({eventEmitter: events.EventEmitter}))

      .then(response => expect(response._getData()).to.equal('trace'))
  });

  it('responds with 404 if a request cannot be handled', () => {
    return new k.api.express.ApiHandler(express())

      .handle(
        httpMocks.createRequest({method: 'GET', url: '/foo'}),
        httpMocks.createResponse({eventEmitter: events.EventEmitter}))

      .then(response => {
        expect(response.statusCode).to.equal(404);
        expect(response._getData()).to.equal('Cannot GET /foo');
      })
  });

  it('responds with 403 Error for Rejections', () => {
    const request  = httpMocks.createRequest({method: 'GET', url: '/foo'});
    const response = httpMocks.createResponse({eventEmitter: events.EventEmitter});

    return new k.api.express.ApiHandler(express()
      .get('/foo', () => {
        throw new k.Rejection('NOPE', 'Nope')
      }), {traceId: () => 'trace'})

      .handle(request, response)

      .then(() => {
        expect(response.statusCode).to.equal(403);
        expect(response._getData()).to.eql({
          code: 'NOPE',
          message: 'Nope',
          traceId: 'trace'
        });
      })
  });

  it('responds with 500 for unknown Errors', () => {
    const request  = httpMocks.createRequest({method: 'GET', url: '/foo'});
    const response = httpMocks.createResponse({eventEmitter: events.EventEmitter});

    return new k.api.express.ApiHandler(express()
      .get('/foo', () => {
        throw new Error('Nope')
      }), {traceId: () => 'trace'})

      .handle(request, response)

      .then(() => {
        expect(response.statusCode).to.equal(500);
        expect(response._getData()).to.eql({
          code: 'UNKNOWN_ERROR',
          message: 'Nope',
          traceId: 'trace'
        });
      })
  });
});