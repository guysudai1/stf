import {EventEmitter} from 'node:events'
import {expect} from 'chai'

import logger from '../../lib/util/logger.js'
import wire from '../../lib/wire/index.js'
import wireutil from '../../lib/wire/util.js'
import publisher from '../../lib/units/log/publisher.js'
import healthlog from '../../lib/util/healthlog.js'
import {importFresh, mockModule} from '../helpers/module-mock.mts'

class FakeSocket extends EventEmitter {
  sent: unknown[][] = []
  send(message: unknown[]) {
    this.sent.push(message)
  }
  connect() {}
  close() {}
  subscribe() {}
}

describe('Health logs', function() {
  it('uses named device status values for user-facing messages', function() {
    expect(wireutil.deviceStatusName(wire.DeviceStatus.ONLINE)).to.equal('ONLINE')
    expect(wireutil.deviceStatusName(undefined)).to.equal('UNKNOWN')
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
    var sent: unknown[][] = []
    var stop = publisher({
      send: function(message: unknown[]) {
        sent.push(message)
      }
    } as never)
    var log = logger.createLogger('health-test')
    log.info('ignored')
    log.important('kept')
    log.warn('kept')
    log.error('kept')
    stop()

    expect(sent).to.have.length(3)
    var envelope = wire.Envelope.decode(sent[0]![1] as Buffer)
    expect(wire.HealthLogMessage.decode(envelope.message).priority)
      .to.equal(logger.Level.IMPORTANT)
  })

  it('forwards only important and higher entries from the generic logger', function() {
    var sent: unknown[][] = []
    var stop = publisher({send: (message: unknown[]) => sent.push(message)} as never)
    logger.createLogger('device:plugins:group').important('Now owned by "a@b.c"')
    logger.createLogger('health-test').info('noise')
    stop()
    expect(sent).to.have.length(1)
    var envelope = wire.Envelope.decode(sent[0]![1] as Buffer)
    expect(wire.HealthLogMessage.decode(envelope.message).priority).to.equal(logger.Level.INFO)
  })

  it('does not forward the scanner console warning that has its own structured entry', function() {
    var sent: unknown[][] = []
    var stop = publisher({send: (message: unknown[]) => sent.push(message)} as never)
    var log = logger.createLogger('provider')
    log.warn('Remote ADB connect failed for %s:%d: %s', '10.0.0.5', 5555, 'refused')
    log.warn('Remote ADB result callback failed: %s', 'boom')
    stop()
    expect(sent).to.have.length(1)
  })

  describe('classify', function() {
    var L = logger.Level
    function level(tag: string, message: string, priority = L.IMPORTANT) {
      return healthlog.classify({priority: priority, tag: tag, message: message})
    }

    it('downgrades routine events to info', function() {
      expect(level('device:plugins:group', 'Now owned by "a@b.c"')).to.equal(L.INFO)
      expect(level('device:plugins:group', 'No longer owned by "a" (reason: x)')).to.equal(L.INFO)
      expect(level('device:plugins:connect', 'Remote Connect Started for device "x" at "y"'))
        .to.equal(L.INFO)
      expect(level('device:plugins:connect', 'Remote Connect Stopped for device "x"'))
        .to.equal(L.INFO)
      expect(level('device:connection:found', 'Found device')).to.equal(L.INFO)
      expect(level('device:connection:registered', 'ack')).to.equal(L.INFO)
      expect(level('device:connection:remote-connected', 'ok')).to.equal(L.INFO)
      expect(level('device:lifecycle:present', 'Device became present')).to.equal(L.INFO)
      expect(level('device:lifecycle:ready', 'Device worker is ready')).to.equal(L.INFO)
      expect(level('processor', 'Restoring device "x" to "y"')).to.equal(L.INFO)
    })

    it('classifies status changes by the resulting status', function() {
      var tag = 'device:connection:status'
      ;['ONLINE', 'CONNECTING', 'AUTHORIZING'].forEach(function(status) {
        expect(level(tag, 'Connection status changed to ' + status + ' (ADB type "x")'))
          .to.equal(L.INFO)
      })
      ;['UNAUTHORIZED', 'OFFLINE'].forEach(function(status) {
        expect(level(tag, 'Connection status changed to ' + status + ' (ADB type "x")'))
          .to.equal(L.WARNING)
      })
    })

    it('leaves notable and already-leveled entries alone', function() {
      expect(level('api:controllers:adbkeys', 'Admin a added ADB key')).to.equal(L.IMPORTANT)
      expect(level('device:plugins:service', 'Service connection ended')).to.equal(L.IMPORTANT)
      expect(level('device:connection:registration-timeout', 'timed out', L.WARNING))
        .to.equal(L.WARNING)
      expect(level('device:connection:worker-exit', 'code 1', L.ERROR)).to.equal(L.ERROR)
      expect(level('device:plugins:group', 'Now owned by "a"', L.WARNING)).to.equal(L.WARNING)
    })
  })

  it('relays health logs from both sides of the processor to the app side', async function() {
    var sockets: FakeSocket[] = []
    var restore = [
      mockModule(new URL('../../lib/util/zmqutil.js', import.meta.url), {
        default: {
          socket: function() {
            var sock = new FakeSocket()
            sockets.push(sock)
            return sock
          }
        }
      })
    , mockModule(new URL('../../lib/db/index.js', import.meta.url), {
        default: {
          ensureConnectivity: function(fn: unknown) {
            return fn
          }
        }
      })
    , mockModule(new URL('../../lib/db/api.js', import.meta.url), {default: {}})
    ]
    try {
      var processor = await importFresh(
        new URL('../../lib/units/processor/index.js', import.meta.url)
      )
      processor.default({endpoints: {appDealer: [], devDealer: []}})
    }
    finally {
      restore.forEach(function(fn) {
        fn()
      })
    }

    var appDealer = sockets[0]!
    var devDealer = sockets[1]!
    var data = wireutil.envelope(new wire.HealthLogMessage(
      1700000000, logger.Level.WARNING, 'test', 1, 'msg', 'id', 'abc', 'device'))
    var other = wireutil.envelope(new wire.ProbeMessage())

    devDealer.emit('message', wireutil.global, data)
    appDealer.emit('message', wireutil.global, data)
    appDealer.emit('message', wireutil.global, other)

    expect(appDealer.sent).to.deep.equal([
      [wireutil.global, data]
    , [wireutil.global, data]
    ])
    expect(devDealer.sent).to.deep.equal([[wireutil.global, other]])
  })

  it('publishes processor lifecycle entries with the device serial', function() {
    var socket = new FakeSocket()
    publisher.send(socket as never, {
      timestamp: 1700000000000
    , priority: logger.Level.IMPORTANT
    , tag: 'device:lifecycle:present'
    , pid: 1
    , message: 'Device became present'
    , identifier: 'proc001'
    }, {serial: 'abc', kind: 'processor'})

    var envelope = wire.Envelope.decode(socket.sent[0]![1] as Buffer)
    var message = wire.HealthLogMessage.decode(envelope.message)
    expect(message.timestamp).to.equal(1700000000)
    expect(message.serial).to.equal('abc')
    expect(message.kind).to.equal('processor')
  })
})
