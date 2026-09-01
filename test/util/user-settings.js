var chai = require('chai')
var expect = chai.expect

var usersettings = require('../../lib/util/user-settings')

describe('User settings', function() {
  describe('validateDeviceTimeout', function() {
    it('should accept a positive integer timeout', function() {
      expect(usersettings.validateDeviceTimeout(30000)).to.deep.equal({
        valid: true
      , value: 30000
      })
    })

    it('should normalize an empty or zero timeout to provider fallback', function() {
      expect(usersettings.validateDeviceTimeout(null).value).to.equal(null)
      expect(usersettings.validateDeviceTimeout(0).value).to.equal(null)
    })

    it('should reject fractional and excessive timeouts', function() {
      expect(usersettings.validateDeviceTimeout(1.5).valid).to.equal(false)
      expect(usersettings.validateDeviceTimeout(
        usersettings.MAX_DEVICE_TIMEOUT + 1
      ).valid).to.equal(false)
    })
  })

  describe('normalizeChanges', function() {
    it('should preserve unrelated settings while normalizing device timeout', function() {
      expect(usersettings.normalizeChanges({
        language: 'en'
      , deviceTimeout: 30000
      })).to.deep.equal({
        language: 'en'
      , deviceTimeout: 30000
      })
    })

    it('should reject an invalid device timeout', function() {
      expect(function() {
        usersettings.normalizeChanges({deviceTimeout: 1.5})
      }).to.throw(RangeError)
    })
  })

  describe('resolveTimeout', function() {
    it('should prefer an explicit timeout over the user setting', function() {
      expect(usersettings.resolveTimeout(60000, {
        deviceTimeout: 30000
      })).to.equal(60000)
    })

    it('should use the user setting when no explicit timeout is provided', function() {
      expect(usersettings.resolveTimeout(null, {
        deviceTimeout: 30000
      })).to.equal(30000)
    })

    it('should return provider fallback when neither timeout is set', function() {
      expect(usersettings.resolveTimeout(null, {})).to.equal(null)
    })
  })
})
