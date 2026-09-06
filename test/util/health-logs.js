var chai = require('chai')
var expect = chai.expect

var logger = require('../../lib/util/logger')
var wire = require('../../lib/wire')
var wireutil = require('../../lib/wire/util')
var publisher = require('../../lib/units/log/publisher')
var healthlog = require('../../lib/util/healthlog')

describe('Health logs', function() {
  it('uses named device status values for user-facing messages', function() {
    expect(wireutil.deviceStatusName(wire.DeviceStatus.ONLINE)).to.equal('ONLINE')
    expect(wireutil.deviceStatusName('offline')).to.equal('OFFLINE')
  })

  it('presents severity labels and keeps stack details separate', function() {
    var entry = healthlog.present({
      priority: logger.Level.ERROR
    , message: 'Request failed\nError: details'
    })

    expect(entry.levelLabel).to.equal('Error')
    expect(entry.severity).to.equal('error')
    expect(entry.messageSummary).to.equal('Request failed')
    expect(entry.details).to.equal('Error: details')
  })

  it('round trips health log wire messages without device logcat fields', function() {
    var message = new wire.HealthLogMessage(
      1700000000, logger.Level.ERROR, 'api', 42, 'failed', 'server', 'abc', 'server')
    var decoded = wire.HealthLogMessage.decode(message.encode())

    expect(decoded.priority).to.equal(logger.Level.ERROR)
    expect(decoded.serial).to.equal('abc')
    expect(decoded.kind).to.equal('server')
  })

  it('publishes important and higher entries only', function() {
    var sent = []
    var stop = publisher({
      send: function(message) { sent.push(message) }
    })
    var log = logger.createLogger('health-test')
    log.info('ignored')
    log.important('kept')
    log.warn('kept')
    log.error('kept')
    stop()

    expect(sent).to.have.length(3)
    var envelope = wire.Envelope.decode(sent[0][1])
    expect(wire.HealthLogMessage.decode(envelope.message).priority)
      .to.equal(logger.Level.IMPORTANT)
  })
})
