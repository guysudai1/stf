import {EventEmitter} from 'node:events'
import {expect} from 'chai'
import createScanner, {
  expandHosts
, normalizeCIDR
, parsePorts
, validateConfig
} from '../../lib/util/remote-adb-scanner.js'

function fakeNet() {
  return {
    createConnection: function(options: {host: string}) {
      var socket: any = new EventEmitter()
      socket.setTimeout = function() {}
      socket.destroy = function() {}
      setImmediate(function() {
        if (options.host === '10.0.0.1') {
          socket.emit('connect')
        }
        else {
          socket.emit('error', new Error('closed'))
        }
      })
      return socket
    }
  } as any
}

describe('Remote ADB scanner', function() {
  describe('CIDR handling', function() {
    it('normalizes a subnet and excludes network and broadcast hosts', function() {
      expect(normalizeCIDR('192.168.1.23/24').cidr).to.equal('192.168.1.0/24')
      expect(expandHosts('192.168.1.0/30')).to.deep.equal(['192.168.1.1', '192.168.1.2'])
    })

    it('retains both endpoints for /31 and the endpoint for /32', function() {
      expect(expandHosts('10.0.0.0/31')).to.deep.equal(['10.0.0.0', '10.0.0.1'])
      expect(expandHosts('10.0.0.9/32')).to.deep.equal(['10.0.0.9'])
    })

    it('deduplicates ports and rejects invalid configurations', function() {
      expect(parsePorts('5555,9999,5555')).to.deep.equal([5555, 9999])
      expect(function() {
        parsePorts('5555,')
      }).to.throw()
      expect(function() {
        validateConfig({subnet: '10.0.0.0/20', ports: [1, 2]})
      }).to.throw(/4096/)
      expect(function() {
        validateConfig({subnet: '10.0.0.0/24', intervalSeconds: 0})
      }).to.throw(/interval/)
      expect(validateConfig({}).enabled).to.equal(false)
    })

    it('trims and canonicalises, rejecting malformed subnets', function() {
      expect(normalizeCIDR('  10.0.0.77/24 ').cidr).to.equal('10.0.0.0/24')
      expect(normalizeCIDR('10.1.2.3/0').cidr).to.equal('0.0.0.0/0')
      expect(normalizeCIDR('10.1.2.3/31').cidr).to.equal('10.1.2.2/31')
      var bad = ['', 'abc', '1.2.3/24', '1.2.3.4', '1.2.3.4/33', '256.1.1.1/24', '1.2.3.4/a'
        , '1.2.3.4/24/1', '1.2.3.4/ 24', null, 5]
      bad.forEach(function(value) {
        expect(function() {
          normalizeCIDR(value)
        }, String(value)).to.throw('Remote ADB subnet must be an IPv4 CIDR')
      })
    })

    it('parses ports from strings and arrays', function() {
      expect(parsePorts('5555, 5556 ,5555,1,65535')).to.deep.equal([5555, 5556, 1, 65535])
      expect(parsePorts(['5555', ' 6000 '])).to.deep.equal([5555, 6000])
      var empty = ['', ' ', ',5555', '5555,,6000']
      empty.forEach(function(value) {
        expect(function() {
          parsePorts(value)
        }).to.throw('non-empty comma-separated list')
      })
      var range = ['0', '65536', 'abc', '-1', '1.5', '0x10', '1e3']
      range.forEach(function(value) {
        expect(function() {
          parsePorts(value)
        }).to.throw('integers from 1 to 65535')
      })
    })

    it('caps the scan at 4096 address-port pairs and applies defaults', function() {
      expect(function() {
        validateConfig({subnet: '10.0.0.0/20', ports: '5555'})
      }).not.to.throw()
      expect(function() {
        validateConfig({subnet: '10.0.0.0/19', ports: '5555'})
      }).to.throw(/4096/)
      expect(function() {
        validateConfig({subnet: '10.0.0.0/20', ports: '5555,5556'})
      }).to.throw(/4096/)
      var config = validateConfig({subnet: '10.0.0.77/24'})
      expect(config.enabled).to.equal(true)
      expect(config.intervalSeconds).to.equal(300)
      expect(config.ports).to.deep.equal([5555])
      expect(config.subnet!.cidr).to.equal('10.0.0.0/24')
      expect(expandHosts('10.0.0.5/24')).to.have.lengthOf(254)
    })
  })

  it('probes responsive endpoints and connects only those endpoints', async function() {
    var connects: [string, number][] = []
    var current = createScanner({
      subnet: '10.0.0.0/30'
    , ports: [5555]
    , intervalSeconds: 60
    , net: fakeNet()
    , client: {
        connect: function(host: string, port: number) {
          connects.push([host, port])
          return Promise.resolve()
        }
      }
    })

    var summary = await current.start()
    expect(summary.responsive).to.equal(1)
    expect(connects).to.deep.equal([['10.0.0.1', 5555]])
    current.stop()
  })

  it('logs the endpoint and the adb error when connect fails', async function() {
    var warnings: unknown[][] = []
    var current = createScanner({
      subnet: '10.0.0.0/30'
    , ports: [5555]
    , intervalSeconds: 60
    , net: fakeNet()
    , log: {
        info: function() {}
      , warn: function(...args: unknown[]) {
          warnings.push(args)
        }
      }
    , client: {
        connect: function() {
          return Promise.reject(new Error('unable to connect to 10.0.0.1:5555'))
        }
      }
    })

    var summary = await current.start()
    expect(summary.responsive).to.equal(1)
    expect(summary.connected).to.equal(0)
    expect(summary.failed).to.equal(1)
    expect(warnings).to.have.lengthOf(1)
    expect(warnings[0]![1]).to.equal('10.0.0.1')
    expect(warnings[0]![2]).to.equal(5555)
    expect(warnings[0]![3]).to.equal('unable to connect to 10.0.0.1:5555')
    current.stop()
  })

  it('reports connect results through onResult, surviving a throwing callback', async function() {
    var results: unknown[] = []
    var current = createScanner({
      subnet: '10.0.0.0/30'
    , net: fakeNet()
    , onResult: function(result) {
        results.push(result)
      }
    , client: {connect: () => Promise.resolve()}
    })
    await current.start()
    expect(results).to.deep.equal([{host: '10.0.0.1', port: 5555, connected: true}])
    current.stop()

    results = []
    var failing = createScanner({
      subnet: '10.0.0.0/30'
    , net: fakeNet()
    , onResult: function(result) {
        results.push(result)
        throw new Error('callback broke')
      }
    , client: {connect: () => Promise.reject(new Error('refused'))}
    })
    var summary = await failing.start()
    expect(summary.failed).to.equal(1)
    expect(results).to.deep.equal([
      {host: '10.0.0.1', port: 5555, connected: false, error: 'refused'}
    ])
    failing.stop()
  })

  it('logs one summary per cycle and does nothing once stopped', async function() {
    var infos: unknown[][] = []
    var current = createScanner({
      subnet: '10.0.0.0/30'
    , intervalSeconds: 3600
    , net: fakeNet()
    , log: {info: (...args: unknown[]) => infos.push(args), warn: function() {}}
    , client: {connect: () => Promise.resolve()}
    })
    await current.start()
    expect(infos).to.deep.equal([[
      'Remote ADB scan %s: %d responsive endpoint(s), %d connected, %d failed'
    , '10.0.0.0/30', 1, 1, 0
    ]])
    current.stop()
    expect(await current.start()).to.deep.equal({responsive: 0, connected: 0, failed: 0})
    expect(infos).to.have.lengthOf(1)
  })

  it('rejects a bad config at construction', function() {
    expect(function() {
      createScanner({subnet: 'nope', client: {connect: () => null}})
    }).to.throw('Remote ADB subnet must be an IPv4 CIDR')
  })
})
