/**
 * Discover ADB-over-TCP devices on a bounded IPv4 subnet.
 */

import net from 'net'
import Promise from 'bluebird'

var MAX_TARGETS = 4096
var PROBE_TIMEOUT = 1000
var CONCURRENCY = 32

var SUBNET_ERROR = 'Remote ADB subnet must be an IPv4 CIDR'

export interface Cidr {
  cidr: string
  network: number
  prefix: number
  size: number
}

export interface ScannerOptions {
  subnet?: string | null | undefined
  ports?: string | readonly (string | number)[] | undefined
  intervalSeconds?: number | string | undefined
  client: {connect(host: string, port: number): PromiseLike<unknown> | unknown}
  net?: Pick<typeof net, 'createConnection'>
  onResult?: (result: ScanResult) => void
  log?: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
  }
}

export interface ScannerConfig {
  enabled: boolean
  subnet?: Cidr
  ports: number[]
  intervalSeconds: number
}

export interface ScanResult {
  host: string
  port: number
  connected: boolean
  error?: string
}

export interface ScanSummary {
  responsive: number
  connected: number
  failed: number
}

function parseIPv4(value: string) {
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

function formatIPv4(value: number) {
  return [
    (value >>> 24) & 255
  , (value >>> 16) & 255
  , (value >>> 8) & 255
  , value & 255
  ].join('.')
}

export function normalizeCIDR(value: unknown): Cidr {
  if (typeof value !== 'string') {
    throw new Error(SUBNET_ERROR)
  }

  var parts = value.trim().split('/')
  if (parts.length !== 2 || !/^\d+$/.test(parts[1]!)) {
    throw new Error(SUBNET_ERROR)
  }

  var prefix = Number(parts[1])
  var address = parseIPv4(parts[0]!)
  if (address === null || prefix < 0 || prefix > 32) {
    throw new Error(SUBNET_ERROR)
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

export function parsePorts(value: unknown): number[] {
  var values: unknown[] = Array.isArray(value) ? value : String(value || '').split(',')
  if (!values.length || values.some(function(item) {
    return String(item).trim() === ''
  })) {
    throw new Error('Remote ADB ports must be a non-empty comma-separated list')
  }

  var ports: number[] = []
  values.forEach(function(item) {
    var text = String(item).trim()
    var port = Number(text)
    if (!/^\d+$/.test(text) || port < 1 || port > 65535) {
      throw new Error('Remote ADB ports must contain integers from 1 to 65535')
    }
    if (ports.indexOf(port) === -1) {
      ports.push(port)
    }
  })
  return ports
}

export function validateConfig(
  options: Pick<ScannerOptions, 'subnet' | 'ports' | 'intervalSeconds'>
): ScannerConfig {
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

export function expandHosts(subnet: string | Cidr): string[] {
  var normalized = typeof subnet === 'string' ? normalizeCIDR(subnet) : subnet
  var first = normalized.network
  var last = (normalized.network + normalized.size - 1) >>> 0
  var start = normalized.prefix >= 31 ? first : first + 1
  var end = normalized.prefix >= 31 ? last : last - 1
  var hosts: string[] = []
  for (var address = start; address <= end; ++address) {
    hosts.push(formatIPv4(address >>> 0))
  }
  return hosts
}

interface Dependencies {
  net: Pick<typeof net, 'createConnection'>
  sockets: Set<net.Socket>
}

function probe(host: string, port: number, dependencies: Dependencies) {
  return new Promise<boolean>(function(resolve) {
    var socket: net.Socket
    try {
      socket = dependencies.net.createConnection({host: host, port: port})
    }
    catch (err) {
      resolve(false)
      return
    }
    function finish(open: boolean) {
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

export function createScanner(options: ScannerOptions) {
  var config = validateConfig(options)
  var dependencies: Dependencies = {
    net: options.net || net
  , sockets: new Set()
  }
  var log = options.log || {
    info: function() {}
  , warn: function() {}
  }
  function report(result: ScanResult) {
    try {
      options.onResult?.(result)
    }
    catch (err) {
      log.warn('Remote ADB result callback failed: %s', (err as Error).message)
    }
  }
  var timer: NodeJS.Timeout | undefined
  var stopped = false

  function cycle(): Promise<ScanSummary> {
    if (stopped || !config.enabled) {
      return Promise.resolve({responsive: 0, connected: 0, failed: 0})
    }
    var cidr = config.subnet!
    var targets: {host: string, port: number}[] = []
    expandHosts(cidr).forEach(function(host) {
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
            report({host: target.host, port: target.port, connected: true})
          })
          .catch(function(err: Error | undefined) {
            failed += 1
            log.warn('Remote ADB connect failed for %s:%d: %s'
            , target.host, target.port, err && err.message || err)
            report({
              host: target.host
            , port: target.port
            , connected: false
            , error: String(err && err.message || err)
            })
          })
      })
    }, {concurrency: CONCURRENCY}).then(function() {
      if (!stopped) {
        log.info(
          'Remote ADB scan %s: %d responsive endpoint(s), %d connected, %d failed'
        , cidr.cidr
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

export default createScanner
