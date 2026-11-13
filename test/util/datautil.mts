import * as chai from 'chai'
var expect = chai.expect

import datautil from '../../lib/util/datautil.js'
import type deviceutil from '../../lib/util/deviceutil.js'

type Claim = {email: string, expiresAt: number}

describe('datautil', function() {
  describe('normalize', function() {
    var user: deviceutil.Viewer = {email: 'user@example.com', privilege: 'user'}

    function device(restoreOwner: Claim | null): datautil.Device & {ready: boolean} {
      return {
        present: true
      , ready: true
      , group: {id: 'group1'}
      , owner: null
      , restoreOwner: restoreOwner
      }
    }

    // normalize enriches rather than whitelists and every device response goes through it, so a
    // claim naming a user would otherwise be handed to anyone who can see the device
    it('should never let the held-for user leave the server', function() {
      var held = device({email: 'someone@example.com', expiresAt: Date.now() + 60000})
      datautil.normalize(held, user)
      expect(held).to.not.have.property('restoreOwner')
      expect(held.claimed).to.be.true
    })

    // isAddable reads `claimed`, and the expiry is judged nowhere else on that path, so an expired
    // claim left reading as held would keep a device untakeable until it next became ready
    it('should stop reporting a device as held once the claim expires', function() {
      var stale = device({email: 'someone@example.com', expiresAt: Date.now() - 1})
      datautil.normalize(stale, user)
      expect(stale.claimed).to.be.false
      expect(stale).to.not.have.property('restoreOwner')
    })

    it('should report an unclaimed device as not held', function() {
      var free = device(null)
      datautil.normalize(free, user)
      expect(free.claimed).to.be.false
    })
  })
  describe('applyOwner', function() {
    function owned(email: string): datautil.Device & {ready: boolean} {
      return {present: true, ready: true, owner: {email: email}} as
        datautil.Device & {ready: boolean}
    }

    it('should mark a device as used only for its own owner', function() {
      var admin: deviceutil.Viewer = {email: 'admin@example.com', privilege: 'admin'}
      expect(datautil.applyOwner(owned('admin@example.com'), admin).using).to.be.true
      expect(datautil.applyOwner(owned('other@example.com'), admin).using).to.be.false
    })

    it('should not mark an unowned device as used', function() {
      var device = {present: true, ready: true, owner: null} as datautil.Device
      expect(datautil.applyOwner(device, {email: 'a@example.com', privilege: 'admin'}).using)
        .to.be.false
    })
  })
})
