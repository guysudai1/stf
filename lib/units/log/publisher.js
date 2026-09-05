/**
 * Forward server warning/error/fatal entries to the shared health-log stream.
 * Device logcat continues to use DeviceLogMessage and is deliberately kept
 * out of this path.
 */

var logger = require('../../util/logger')
var wire = require('../../wire')
var wireutil = require('../../wire/util')

module.exports = function(push, options) {
  var publisherOptions = options || {}

  function listener(entry) {
    if (entry.priority < logger.Level.WARNING) {
      return
    }

    var message = new wire.HealthLogMessage(
        entry.timestamp.getTime() / 1000
      , entry.priority
      , entry.tag
      , entry.pid
      , entry.message
      , entry.identifier
      , publisherOptions.serial
      , publisherOptions.kind || 'server'
      )

    push.send([
      wireutil.global
    , wireutil.envelope(message)
    ])
  }

  logger.on('entry', listener)
  return function() {
    logger.removeListener('entry', listener)
  }
}
