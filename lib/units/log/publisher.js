/**
 * Forward important and higher server entries to the shared health-log stream.
 * Device logcat continues to use DeviceLogMessage and is deliberately kept
 * out of this path.
 */

var logger = require('../../util/logger')
var wire = require('../../wire')
var wireutil = require('../../wire/util')

function send(push, entry, options) {
  var publisherOptions = options || {}

  if (entry.priority < logger.Level.IMPORTANT) {
    return
  }

  var timestamp = entry.timestamp instanceof Date ?
    entry.timestamp.getTime() / 1000 : Number(entry.timestamp) / 1000
  var message = new wire.HealthLogMessage(
      timestamp
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

module.exports = function(push, options) {
  function listener(entry) {
    send(push, entry, options)
  }

  logger.on('entry', listener)
  return function() {
    logger.removeListener('entry', listener)
  }
}

module.exports.send = send
