var syrup = require('@devicefarmer/stf-syrup')

var logger = require('../../../util/logger')
var wire = require('../../../wire')
var wireutil = require('../../../wire/util')
var lifecycle = require('../../../util/lifecycle')
var publishHealthLog = require('../../log/publisher')

module.exports = syrup.serial()
  .dependency(require('../support/push'))
  .define(function(options, push) {
    lifecycle.observe(publishHealthLog(push, {
      serial: options.serial
    , kind: 'device'
    }))

    // Forward all logs
    logger.on('entry', function(entry) {
      push.send([
        wireutil.global
      , wireutil.envelope(new wire.DeviceLogMessage(
          options.serial
        , entry.timestamp / 1000
        , entry.priority
        , entry.tag
        , entry.pid
        , entry.message
        , entry.identifier
        ))
      ])
    })

    return logger
  })
