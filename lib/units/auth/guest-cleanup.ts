import Promise from 'bluebird'

import dbapi from '../../db/api.js'
import logger from '../../util/logger.js'
import type {DeviceDocument, UserDocument} from '../../types/stf.js'

var log = logger.createLogger('auth-guest')

export var GUEST_DOMAIN = '@guest.local'
var MAX_AGE = 30 * 24 * 3600 * 1000
var INTERVAL = 3600 * 1000

export function selectStaleGuests<U extends Pick<UserDocument, 'email' | 'lastLoggedInAt'>>(
  users: U[]
, devices: Pick<DeviceDocument, 'owner'>[]
, now: number
) {
  var holders = new Set(devices.map(function(device) {
    return device.owner?.email
  }))
  return users.filter(function(user) {
    return user.email.endsWith(GUEST_DOMAIN) &&
      new Date(user.lastLoggedInAt).getTime() < now - MAX_AGE &&
      !holders.has(user.email)
  })
}

function removeGuest(user: UserDocument) {
  return dbapi.getGroupsByUser(user.email).then(function(groups) {
    return Promise.each(groups, function(group) {
      return group.owner.email === user.email ?
        dbapi.deleteUserGroup(group.id) :
        dbapi.removeGroupUser(group.id, user.email)
    })
  })
  .then(function() {
    return dbapi.removeUserAccessTokens(user.email)
  })
  .then(function() {
    return dbapi.deleteUser(user.email)
  })
}

export function cleanupGuests() {
  return Promise.all([dbapi.getUsers(), dbapi.getDevices()])
    .then(function(results) {
      var stale = selectStaleGuests(results[0], results[1], Date.now())
      return Promise.each(stale, function(user) {
        return removeGuest(user)
      })
      .then(function() {
        if (stale.length) {
          log.info('Removed %d inactive guest user(s)', stale.length)
        }
      })
    })
    .catch(function(err) {
      log.error('Guest cleanup failed', err.stack || err)
    })
}

export function startCleanup() {
  cleanupGuests()
  return setInterval(cleanupGuests, INTERVAL).unref()
}
