import * as chai from 'chai'
var expect = chai.expect

import type {selectStaleGuests as SelectStaleGuests} from '../../../lib/units/auth/guest-cleanup.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

mockModule(new URL('../../../lib/db/index.js', import.meta.url), {default: {
  run: function() {
    return Promise.resolve({})
  }
}})

var selectStaleGuests: typeof SelectStaleGuests = (await importFresh(
  new URL('../../../lib/units/auth/guest-cleanup.js', import.meta.url)
)).selectStaleGuests

describe('guest cleanup', function() {
  var now = Date.parse('2026-11-13T00:00:00Z')
  var day = 24 * 3600 * 1000

  function user(email: string, ageDays: number) {
    return {email: email, lastLoggedInAt: new Date(now - ageDays * day)}
  }

  function select(
    users: ReturnType<typeof user>[]
  , devices: {owner: {email: string} | null}[] = []
  ) {
    return selectStaleGuests(users, devices as never, now).map(function(u) {
      return u.email
    })
  }

  it('should select guests last seen more than 30 days ago', function() {
    expect(select([user('a@guest.local', 31)])).to.deep.equal(['a@guest.local'])
  })

  it('should keep guests seen within 30 days', function() {
    expect(select([user('a@guest.local', 29)])).to.deep.equal([])
  })

  it('should never select non-guest users', function() {
    expect(select([user('a@example.com', 400), user('a@guest.local.evil.com', 400)]))
      .to.deep.equal([])
  })

  it('should keep guests who hold a device', function() {
    expect(select(
      [user('a@guest.local', 90), user('b@guest.local', 90)]
    , [{owner: {email: 'a@guest.local'}}, {owner: null}]
    )).to.deep.equal(['b@guest.local'])
  })
})
