describe('EnhanceDeviceService', function() {

  beforeEach(angular.mock.module(require('../').name))
  beforeEach(angular.mock.module(function($provide) {
    $provide.value('gettext', function(text) {
      return text
    })
  }))

  var service

  beforeEach(inject(function(EnhanceDeviceService) {
    service = EnhanceDeviceService
  }))

  function enhance(status) {
    var device = {
      present: true,
      status: status,
      ready: false,
      group: {
        owner: {
          email: 'admin@localhost'
        }
      }
    }
    service.enhance(device)
    return device
  }

  it('shows connecting instead of connected while ADB is connecting', function() {
    var device = enhance('CONNECTING')

    expect(device.state).toBe('connecting')
    expect(device.enhancedStateAction).toBe('Connecting')
  })

  it('shows authorizing instead of connected while ADB is authorizing', function() {
    var device = enhance(5)

    expect(device.state).toBe('authorizing')
    expect(device.enhancedStateAction).toBe('Authorizing')
  })

  it('treats a present device without a status as connecting', function() {
    var device = enhance()

    expect(device.state).toBe('connecting')
    expect(device.enhancedStateAction).toBe('Connecting')
  })
})
