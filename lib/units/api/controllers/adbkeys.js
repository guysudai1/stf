// Admin management of the provider's ADB_VENDOR_KEYS folder. Key contents
// are never logged or returned.
var Promise = require('bluebird')
var apiutil = require('../../../util/apiutil')
var adbkeysutil = require('../../../util/adbkeysutil')
var logger = require('../../../util/logger')

var log = logger.createLogger('api:controllers:adbkeys')

function withDir(req, res, fn) {
  var dir = req.options.adbKeysDir
  if (!dir) {
    return apiutil.respond(res, 503, 'Service Unavailable: no ADB keys directory configured', {
      configured: false
    })
  }
  return fn(dir).catch(function(err) {
    if (err.status) {
      return apiutil.respond(res, err.status, err.message)
    }
    log.error('ADB keys operation failed: %s', err.code || err.message)
    return apiutil.respond(res, 500, 'Internal Server Error')
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
  var body = req.body || {}
  return withDir(req, res, function(dir) {
    return Promise.resolve()
      .then(function() {
        return adbkeysutil.add(dir, body.name, body.key)
      })
      .then(function(key) {
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
