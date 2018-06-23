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

module.exports = {
  Logger
};