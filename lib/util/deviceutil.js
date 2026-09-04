/**
* Copyright © 2019 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var apiutil = require('./apiutil')

var deviceutil = module.exports = Object.create(null)

deviceutil.isOwnedByUser = function(device, user) {
  return device.present &&
         device.ready &&
         device.owner &&
         (device.owner.email === user.email || apiutil.isPrivileged(user.privilege)) &&
         device.using
}

deviceutil.isAddable = function(device) {
  return device.present &&
         device.ready &&
         !device.using &&
         !device.owner
}
