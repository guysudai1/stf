var chai = require('chai')
var expect = chai.expect

var wire = require('../../lib/wire')
var wireutil = require('../../lib/wire/util')

describe('wireutil.deviceStatusName', function() {
  it('names every wire.DeviceStatus value', function() {
    Object.keys(wire.DeviceStatus).forEach(function(name) {
      expect(wireutil.deviceStatusName(wire.DeviceStatus[name])).to.equal(name)
    })
  })

  it('returns UNKNOWN for values outside the enum', function() {
    expect(wireutil.deviceStatusName(99)).to.equal('UNKNOWN')
    expect(wireutil.deviceStatusName(wireutil.toDeviceStatus('bogus'))).to.equal('UNKNOWN')
  })
})
