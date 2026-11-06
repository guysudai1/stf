// Key contents must never be logged or returned.
var apiutil = require('../../../util/apiutil')
var adbkeysutil = require('../../../util/adbkeysutil')
var logger = require('../../../util/logger')

var log = logger.createLogger('api:controllers:adbkeys')

function withDir(req, res, fn) {
  var dir = req.options.adbKeysDir
  if (!dir) {
    return apiutil.respond(res, 503, 'Service Unavailable: no ADB keys directory configured')
  }
  return fn(dir).catch(function(err) {
    if (err.status) {
      return apiutil.respond(res, err.status, err.message)
    }
    return apiutil.internalError(res, 'ADB keys operation failed: %s', err.code || err.message)
  })
}

function getAdbKeys(req, res) {
  if (!req.options.adbKeysDir) {
    return apiutil.respond(res, 200, 'ADB keys directory not configured', {
      configured: false
    , keys: []
    })
  }
  return withDir(req, res, function(dir) {
    return adbkeysutil.list(dir).then(function(keys) {
      apiutil.respond(res, 200, 'ADB Keys Information', {configured: true, keys: keys})
    })
  })
}

function addAdbKey(req, res) {
  return withDir(req, res, function(dir) {
    return adbkeysutil.add(dir, req.body.name, req.body.key).then(function(key) {
      log.important('Admin %s added ADB key "%s" (%s)', req.user.email, key.name, key.fingerprint)
      apiutil.respond(res, 201, 'Created (key)', {key: key})
    })
  })
}

function deleteAdbKey(req, res) {
  var name = req.swagger.params.name.value
  return withDir(req, res, function(dir) {
    return adbkeysutil.remove(dir, name).then(function() {
      log.important('Admin %s deleted ADB key "%s"', req.user.email, name)
      apiutil.respond(res, 200, 'Deleted (key)')
    })
  })
}

module.exports = {
  getAdbKeys: getAdbKeys
, addAdbKey: addAdbKey
, deleteAdbKey: deleteAdbKey
}
