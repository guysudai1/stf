var chai = require('chai')
var expect = chai.expect

var datautil = require('../../lib/util/datautil')
var deviceutil = require('../../lib/util/deviceutil')

function ownedBy(email) {
  return {
    present: true
  , ready: true
  , owner: {email: email, name: 'nickname', group: 'group'}
  }
}

describe('datautil.applyOwner', function() {
  it('marks a device as using for its own owner', function() {
    var device = datautil.applyOwner(ownedBy('a@guest.local'),
      {email: 'a@guest.local', privilege: 'admin'})
    expect(device.using).to.equal(true)
  })

  it('does not mark another admin user session as using', function() {
    var device = datautil.applyOwner(ownedBy('a@guest.local'),
      {email: 'b@guest.local', privilege: 'admin'})
    expect(device.using).to.equal(false)
  })

  it('leaves an unowned device not using', function() {
    var device = datautil.applyOwner({present: true, ready: true, owner: null},
      {email: 'b@guest.local', privilege: 'admin'})
    expect(device.using).to.equal(false)
  })
})

describe('deviceutil.isOwnedByUser', function() {
  // Authorization must not follow the `using` display flag, or every admin
  // user would silently lose access to devices owned by someone else.
  it('still authorizes an admin user on another user device', function() {
    var device = ownedBy('a@guest.local')
    var user = {email: 'b@guest.local', privilege: 'admin'}
    datautil.applyOwner(device, user)
    expect(device.using).to.equal(false)
    expect(deviceutil.isOwnedByUser(device, user)).to.be.ok
  })

  it('authorizes the owner', function() {
    var device = ownedBy('a@guest.local')
    var user = {email: 'a@guest.local', privilege: 'user'}
    expect(deviceutil.isOwnedByUser(device, user)).to.be.ok
  })

  it('refuses a non-admin user on another user device', function() {
    var device = ownedBy('a@guest.local')
    var user = {email: 'b@guest.local', privilege: 'user'}
    expect(deviceutil.isOwnedByUser(device, user)).to.not.be.ok
  })

  it('refuses an absent device', function() {
    var device = ownedBy('a@guest.local')
    device.present = false
    var user = {email: 'a@guest.local', privilege: 'admin'}
    expect(deviceutil.isOwnedByUser(device, user)).to.not.be.ok
  })
})
