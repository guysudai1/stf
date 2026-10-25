var Promise = require('bluebird')

var logger = require('../../util/logger')
var wire = require('../../wire')
var wirerouter = require('../../wire/router')
var wireutil = require('../../wire/util')
var lifecycle = require('../../util/lifecycle')
var srv = require('../../util/srv')
var dbapi = require('../../db/api')
var zmqutil = require('../../util/zmqutil')

module.exports = function(options) {
  var log = logger.createLogger('log-db')

  // Input
  var sub = zmqutil.socket('sub')
  Promise.map(options.endpoints.sub, function(endpoint) {
    return srv.resolve(endpoint).then(function(records) {
      return srv.attempt(records, function(record) {
        log.info('Receiving input from "%s"', record.url)
        sub.connect(record.url)
        return Promise.resolve(true)
      })
    })
  })

  // Establish always-on channels
  ;[wireutil.global].forEach(function(channel) {
    log.info('Subscribing to permanent channel "%s"', channel)
    sub.subscribe(channel)
  })

  sub.on('message', wirerouter()
    .on(wire.DeviceLogMessage, function(channel, message) {
      if (message.priority >= options.priority) {
        dbapi.saveDeviceLog(message.serial, message)
      }
    })
    .on(wire.HealthLogMessage, function(channel, message) {
      dbapi.saveHealthLog(message)
        .catch(function(err) {
          log.error('Unable to save health log', err.stack)
        })
    })
    .handler())

  // Keep the table bounded even when no new messages arrive.
  dbapi.cleanupLogs().catch(function(err) {
    log.error('Unable to clean up old health logs', err.stack)
  })
  var cleanupTimer = setInterval(function() {
    dbapi.cleanupLogs().catch(function(err) {
      log.error('Unable to clean up old health logs', err.stack)
    })
  }, 60 * 60 * 1000)

  log.info('Listening for %s (or higher) level log messages',
    logger.LevelLabel[options.priority])

  lifecycle.observe(function() {
    try {
      sub.close()
    }
    catch (err) {
      // No-op
    }
    clearInterval(cleanupTimer)
  })
}
