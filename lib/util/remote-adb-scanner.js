/* global Set */

/**
 * Discover ADB-over-TCP devices on a bounded IPv4 subnet.
 */

var net = require('net')
var Promise = require('bluebird')

var MAX_TARGETS = 4096
var MAX_CONCURRENCY = 32
var PROBE_TIMEOUT = 1000

function parseIPv4(value) {
  var parts = value.split('.')
  if (parts.length !== 4 || parts.some(function(part) {
    return !/^\d+$/.test(part) || Number(part) > 255
  })) {
    return null
  }

  return parts.reduce(function(result, part) {
    return ((result << 8) | Number(part)) >>> 0
  }, 0)
}

function formatIPv4(value) {
  return [
    (value >>> 24) & 255
  , (value >>> 16) & 255
  , (value >>> 8) & 255
  , value & 255
  ].join('.')
}

function normalizeCIDR(value) {
  if (typeof value !== 'string') {
    throw new Error('Remote ADB subnet must be an IPv4 CIDR')
  }

  var parts = value.trim().split('/')
  if (parts.length !== 2 || !/^\d+$/.test(parts[1])) {
    throw new Error('Remote ADB subnet must be an IPv4 CIDR')
  }

  var prefix = Number(parts[1])
  var address = parseIPv4(parts[0])
  if (address === null || prefix < 0 || prefix > 32) {
    throw new Error('Remote ADB subnet must be an IPv4 CIDR')
  }

  var mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  var network = (address & mask) >>> 0
  return {
    cidr: formatIPv4(network) + '/' + prefix
  , network: network
  , prefix: prefix
  , size: Math.pow(2, 32 - prefix)
  }
}

function parsePorts(value) {
  var values = Array.isArray(value) ? value : String(value || '').split(',')
  if (!values.length || values.some(function(item) {
    return String(item).trim() === ''
  })) {
    throw new Error('Remote ADB ports must be a non-empty comma-separated list')
  }

  var ports = []
  values.forEach(function(item) {
    var text = String(item).trim()
    if (!/^\d+$/.test(text)) {
      throw new Error('Remote ADB ports must contain integers from 1 to 65535')
    }
    var port = Number(text)
    if (port < 1 || port > 65535) {
      throw new Error('Remote ADB ports must contain integers from 1 to 65535')
    }
    if (ports.indexOf(port) === -1) {
      ports.push(port)
    }
  })
  return ports
}

function validateConfig(options) {
  var config = options || {}
  var portValue = typeof config.ports !== 'undefined' ?
    config.ports : config.remoteAdbPorts
  var intervalValue = typeof config.intervalSeconds !== 'undefined' ?
    config.intervalSeconds : config.remoteAdbScanInterval
  var ports = parsePorts(typeof portValue === 'undefined' ? '5555' : portValue)
  var interval = Number(typeof intervalValue === 'undefined' ? 300 : intervalValue)
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error('Remote ADB scan interval must be a positive integer')
  }

  var subnetValue = typeof config.subnet !== 'undefined' ?
    config.subnet : config.remoteAdbSubnet
  if (typeof subnetValue === 'undefined' || subnetValue === null) {
    return {
      enabled: false
    , ports: ports
    , intervalSeconds: interval
    }
  }

  var subnet = normalizeCIDR(subnetValue)
  var hosts = subnet.prefix >= 31 ? subnet.size : Math.max(0, subnet.size - 2)
  if (hosts * ports.length > MAX_TARGETS) {
    throw new Error('Remote ADB subnet scan exceeds the 4096 address-port limit')
  }

  return {
    enabled: true
  , subnet: subnet
  , ports: ports
  , intervalSeconds: interval
  , targetCount: hosts * ports.length
  }
}

function expandHosts(subnet) {
  var normalized = typeof subnet === 'string' ? normalizeCIDR(subnet) : subnet
  var hostCount = normalized.prefix >= 31 ? normalized.size : normalized.size - 2
  if (hostCount > MAX_TARGETS) {
    throw new Error('Remote ADB subnet expansion exceeds the 4096 address limit')
  }
  var first = normalized.network
  var last = (normalized.network + normalized.size - 1) >>> 0
  var start = normalized.prefix >= 31 ? first : first + 1
  var end = normalized.prefix >= 31 ? last : last - 1
  var hosts = []
  for (var address = start; address <= end; ++address) {
    hosts.push(formatIPv4(address >>> 0))
  }
  return hosts
}

function probe(host, port, dependencies) {
  var socket, finishProbe, handlers
  var stopped = false
  var connector = dependencies.net.createConnection || dependencies.net.connect
  var promise = new Promise(function(resolve) {
    var settled = false
    handlers = {}
    function finish(open) {
      if (settled) {
        return
      }
      settled = true
      if (socket) {
        socket.removeListener('connect', handlers.connect)
        socket.removeListener('error', handlers.error)
        socket.removeListener('timeout', handlers.timeout)
        socket.destroy()
      }
      resolve(open)
    }
    handlers.connect = function onConnect() {
      finish(true)
    }
    handlers.error = function onError() {
      finish(false)
    }
    handlers.timeout = function onTimeout() {
      finish(false)
    }
    finishProbe = finish

    try {
      socket = connector.call(dependencies.net, {host: host, port: port})
      dependencies.sockets.add(socket)
      socket.once('connect', handlers.connect)
      socket.once('error', handlers.error)
      socket.once('timeout', handlers.timeout)
      socket.setTimeout(PROBE_TIMEOUT)
      socket.once('close', function() {
        dependencies.sockets.delete(socket)
      })
      if (stopped) {
        finish(false)
      }
    }
    catch (err) {
      finish(false)
    }
  })
  promise.stop = function() {
    stopped = true
    if (finishProbe) {
      finishProbe(false)
    }
    if (socket) {
      socket.destroy()
    }
  }
  dependencies.probes.add(promise)
  promise.then(function() {
    dependencies.probes.delete(promise)
  })
  return promise
}

function createScanner(options) {
  var configOptions = options || {}
  var config = validateConfig(configOptions)
  var dependencies = {
    net: configOptions.net || net
  , setTimeout: configOptions.setTimeout || setTimeout
  , clearTimeout: configOptions.clearTimeout || clearTimeout
  , sockets: new Set()
  , probes: new Set()
  }
  var log = configOptions.log || {
    info: function() {}
  , warn: function() {}
  }
  var timer, activeCycle
  var stopped = false
  var running = false
  var started = false

  function cycle() {
    if (stopped || !config.enabled || running) {
      return Promise.resolve({responsive: 0, connected: 0, failed: 0})
    }
    running = true
    var targets = []
    expandHosts(config.subnet).forEach(function(host) {
      config.ports.forEach(function(port) {
        targets.push({host: host, port: port})
      })
    })
    var responsive = 0
    var connected = 0
    var failed = 0
    var cursor = 0

    function worker() {
      if (stopped || cursor >= targets.length) {
        return Promise.resolve()
      }
      var target = targets[cursor++]
      var current = probe(target.host, target.port, dependencies)
      return current.then(function(open) {
        if (!open || stopped) {
          return Promise.resolve()
        }
        responsive += 1
        return Promise.resolve(configOptions.client.connect(target.host, target.port))
          .then(function() {
            connected += 1
          })
          .catch(function() {
            failed += 1
          })
      }).catch(function() {
        failed += 1
      }).then(worker)
    }

    var workers = []
    for (var i = 0; i < Math.min(MAX_CONCURRENCY, targets.length); ++i) {
      workers.push(worker())
    }
    return Promise.all(workers).then(function() {
      running = false
      if (!stopped) {
        log.info(
          'Remote ADB scan %s: %d responsive endpoint(s), %d connected, %d failed'
        , config.subnet.cidr
        , responsive
        , connected
        , failed
        )
      }
      return {responsive: responsive, connected: connected, failed: failed}
    })
  }

  function schedule() {
    if (!stopped && config.enabled) {
      timer = dependencies.setTimeout(function() {
        timer = null
        cycle().then(schedule, schedule)
      }, config.intervalSeconds * 1000)
    }
  }

  return {
    config: config
  , start: function() {
      if (started) {
        return activeCycle || Promise.resolve()
      }
      started = true
      stopped = false
      var result = cycle()
      activeCycle = result
      result.then(schedule, schedule)
      result.then(function() {
        activeCycle = null
      })
      return result
    }
  , scan: cycle
  , stop: function() {
      stopped = true
      started = false
      if (typeof timer !== 'undefined' && timer !== null) {
        dependencies.clearTimeout(timer)
        timer = null
      }
      dependencies.sockets.forEach(function(socket) {
        socket.destroy()
      })
      dependencies.probes.forEach(function(current) {
        current.stop()
      })
    }
  }
}

module.exports = createScanner
module.exports.createScanner = createScanner
module.exports.MAX_TARGETS = MAX_TARGETS
module.exports.MAX_CONCURRENCY = MAX_CONCURRENCY
module.exports.PROBE_TIMEOUT = PROBE_TIMEOUT
module.exports.normalizeCIDR = normalizeCIDR
module.exports.parsePorts = parsePorts
module.exports.validateConfig = validateConfig
module.exports.expandHosts = expandHosts
module.exports.expandIPv4Hosts = expandHosts
