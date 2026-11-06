var events = require('events')
var chai = require('chai')
var sinon = require('sinon')
var expect = chai.expect

var logger = require('../../lib/util/logger')
var wire = require('../../lib/wire')
var wireutil = require('../../lib/wire/util')
var publisher = require('../../lib/units/log/publisher')
var healthlog = require('../../lib/util/healthlog')
var zmqutil = require('../../lib/util/zmqutil')

describe('Health logs', function() {
  it('uses named device status values for user-facing messages', function() {
    expect(wireutil.deviceStatusName(wire.DeviceStatus.ONLINE)).to.equal('ONLINE')
  })

  it('presents severity labels and keeps stack details separate', function() {
    var entry = healthlog.present({
      priority: logger.Level.ERROR
    , message: 'Request failed\nError: details'
    })

    expect(entry.levelLabel).to.equal('Error')
    expect(entry.severity).to.equal('error')
    expect(healthlog.present({priority: logger.Level.IMPORTANT}).levelLabel)
      .to.equal('Important')
    expect(healthlog.present({priority: 99}).severity).to.equal('unknown')
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
      send: function(message) {
        sent.push(message)
      }
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

  it('relays health logs from both sides of the processor to the app side', function() {
    var sockets = []
    sinon.stub(zmqutil, 'socket', function() {
      var sock = new events.EventEmitter()
      sock.sent = []
      sock.send = function(message) {
        sock.sent.push(message)
      }
      sock.connect = sock.close = function() {}
      sockets.push(sock)
      return sock
    })
    // Requiring the real db module opens a RethinkDB connection.
    var dbPath = require.resolve('../../lib/db')
    require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {
      ensureConnectivity: function(fn) {
        return fn
      }
    }}
    try {
      require('../../lib/units/processor')({endpoints: {appDealer: [], devDealer: []}})
    }
    finally {
      zmqutil.socket.restore()
      delete require.cache[dbPath]
      delete require.cache[require.resolve('../../lib/db/api')]
    }

    var appDealer = sockets[0]
    var devDealer = sockets[1]
    var data = wireutil.envelope(new wire.HealthLogMessage(
      1700000000, logger.Level.WARNING, 'test', 1, 'msg', 'id', 'abc', 'device'))

    devDealer.emit('message', wireutil.global, data)
    appDealer.emit('message', wireutil.global, data)

    expect(appDealer.sent).to.deep.equal([
      [wireutil.global, data]
    , [wireutil.global, data]
    ])
    expect(devDealer.sent).to.have.length(0)
  })
})
