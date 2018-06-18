const chai = require('chai');
const promised = require('chai-as-promised');
chai.use(promised);
chai.should();

const k = require('../..');
const {the, Example, I, expect} = require('../../spec');

describe('Specifying dependencies', () => {

  it('uses injected values');

  it('uses injected stubs');

  it('uses injected values in objects');

  it('uses injected values returned by function');

  it('asserts expected invocations of functions');

  it('fails if expected invocations doe not match');
});