const debug = require('debug');

class Logger {

  log(tag, traceId, message) {
  }

  formatError(error) {
    return error.toString()
  }

  error(tag, traceId, error) {
    this.log('error:' + tag, traceId, this.formatError(error));
  }

  info(tag, traceId, message) {
    this.log('info:' + tag, traceId, message);
  }

  debug(tag, traceId, message) {
    this.log('debug:' + tag, traceId, message);
  }
}

class PrefixedLogger extends Logger {
  constructor(prefix, logger) {
    super();
    this.prefix = prefix;
    this.logger = logger;
  }

  log(tag, traceId, message) {
    this.logger.log(`${this.prefix}:${tag}`, traceId, message);
  }

  formatError(error) {
    return this.logger.formatError(error)
  }
}

class DebugLogger extends Logger {
  constructor() {
    super();
    this.debugs = {};
  }

  log(tag, traceId, message) {
    this.debugs[tag] = this.debugs[tag] || debug(tag);
    this.debugs[tag]('<%s> %j', traceId || 'xxxxxx', message);
  }

  formatError(error) {
    return error && (error.message && error.stack) ? error.stack : error
  }
}

module.exports = {
  Logger,
  DebugLogger,
  PrefixedLogger
};