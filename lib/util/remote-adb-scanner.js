/* global Set */

/**
 * Discover ADB-over-TCP devices on a bounded IPv4 subnet.
 */

var net = require('net')
var Promise = require('bluebird')

var MAX_TARGETS = 4096
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
  var ports = parsePorts(typeof options.ports === 'undefined' ? '5555' : options.ports)
  var interval = Number(typeof options.intervalSeconds === 'undefined' ?
    300 : options.intervalSeconds)
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error('Remote ADB scan interval must be a positive integer')
  }

  if (typeof options.subnet === 'undefined' || options.subnet === null) {
    return {
      enabled: false
    , ports: ports
    , intervalSeconds: interval
    }
  }

  var subnet = normalizeCIDR(options.subnet)
  var hosts = subnet.prefix >= 31 ? subnet.size : subnet.size - 2
  if (hosts * ports.length > MAX_TARGETS) {
    throw new Error('Remote ADB subnet scan exceeds the 4096 address-port limit')
  }

  return {
    enabled: true
  , subnet: subnet
  , ports: ports
  , intervalSeconds: interval
  }
}

function expandHosts(subnet) {
  var normalized = typeof subnet === 'string' ? normalizeCIDR(subnet) : subnet
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
  return new Promise(function(resolve) {
    var socket
    try {
      socket = dependencies.net.createConnection({host: host, port: port})
    }
    catch (err) {
      resolve(false)
      return
    }
    function finish(open) {
      dependencies.sockets.delete(socket)
      socket.destroy()
      resolve(open)
    }
    dependencies.sockets.add(socket)
    socket.setTimeout(PROBE_TIMEOUT)
    socket.once('connect', function() {
      finish(true)
    })
    socket.once('error', function() {
      finish(false)
    })
    socket.once('timeout', function() {
      finish(false)
    })
    socket.once('close', function() {
      finish(false)
    })
  })
}

function createScanner(options) {
  var config = validateConfig(options)
  var dependencies = {
    net: options.net || net
  , sockets: new Set()
  }
  var log = options.log || {
    info: function() {}
  , warn: function() {}
  }
  var timer
  var stopped = false

  function cycle() {
    if (stopped || !config.enabled) {
      return Promise.resolve({responsive: 0, connected: 0, failed: 0})
    }
    var targets = []
    expandHosts(config.subnet).forEach(function(host) {
      config.ports.forEach(function(port) {
        targets.push({host: host, port: port})
      })
    })
    var responsive = 0
    var connected = 0
    var failed = 0

    return Promise.map(targets, function(target) {
      if (stopped) {
        return null
      }
      return probe(target.host, target.port, dependencies).then(function(open) {
        if (!open || stopped) {
          return null
        }
        responsive += 1
        return Promise.try(function() {
          return options.client.connect(target.host, target.port)
        })
          .then(function() {
            connected += 1
          })
          .catch(function(err) {
            failed += 1
            log.warn('Remote ADB connect failed for %s:%d: %s'
            , target.host, target.port, err && err.message || err)
          })
      })
    }, {concurrency: 32}).then(function() {
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
      timer = setTimeout(function() {
        cycle().then(schedule, schedule)
      }, config.intervalSeconds * 1000)
    }
  }

  return {
    config: config
  , start: function() {
      var result = cycle()
      result.then(schedule, schedule)
      return result
    }
  , stop: function() {
      stopped = true
      clearTimeout(timer)
      dependencies.sockets.forEach(function(socket) {
        socket.destroy()
      })
    }
  }
}

module.exports = createScanner
module.exports.normalizeCIDR = normalizeCIDR
module.exports.parsePorts = parsePorts
module.exports.validateConfig = validateConfig
module.exports.expandHosts = expandHosts
