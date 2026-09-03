/* global Promise */

var chai = require('chai')
var EventEmitter = require('events')
var expect = chai.expect

var scanner = require('../../lib/util/remote-adb-scanner')

describe('Remote ADB scanner', function() {
  describe('CIDR handling', function() {
    it('normalizes a subnet and excludes network and broadcast hosts', function() {
      expect(scanner.normalizeCIDR('192.168.1.23/24').cidr).to.equal('192.168.1.0/24')
      expect(scanner.expandHosts('192.168.1.0/30')).to.deep.equal([
        '192.168.1.1', '192.168.1.2'
      ])
    })

    it('retains both endpoints for /31 and the endpoint for /32', function() {
      expect(scanner.expandHosts('10.0.0.0/31')).to.deep.equal([
        '10.0.0.0', '10.0.0.1'
      ])
      expect(scanner.expandHosts('10.0.0.9/32')).to.deep.equal(['10.0.0.9'])
    })

    it('deduplicates ports and rejects invalid configurations', function() {
      expect(scanner.parsePorts('5555,9999,5555')).to.deep.equal([5555, 9999])
      expect(function() {
        scanner.parsePorts('5555,')
      }).to.throw()
      expect(function() {
        scanner.validateConfig({subnet: '10.0.0.0/20', ports: [1, 2]})
      }).to.throw(/4096/)
    })
  })

  it('probes responsive endpoints and connects only those endpoints', function(done) {
    var connects = []
    var fakeNet = {
      createConnection: function(options) {
        var socket = new EventEmitter()
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
    }
    var current = scanner({
      subnet: '10.0.0.0/30'
    , ports: [5555]
    , intervalSeconds: 60
    , net: fakeNet
    , client: {
        connect: function(host, port) {
          connects.push([host, port])
          return Promise.resolve()
        }
      }
    })

    current.start().then(function(summary) {
      expect(summary.responsive).to.equal(1)
      expect(connects).to.deep.equal([['10.0.0.1', 5555]])
      current.stop()
      done()
    }).catch(done)
  })
})
