/**
 * Administrator health and server log endpoints.
 */

var dbapi = require('../../../db/api')
var apiutil = require('../../../util/apiutil')

function requireAdmin(req, res) {
  if (!apiutil.isPrivileged(req.user.privilege)) {
    apiutil.respond(res, 403, 'Forbidden: privileged operation (admin)')
    return false
  }
  return true
}

function getHealthSummary(req, res) {
  if (!requireAdmin(req, res)) {
    return
  }
  dbapi.getHealthSummary()
    .then(function(summary) {
      apiutil.respond(res, 200, 'Health summary', {summary: summary})
    })
    .catch(function(err) {
      apiutil.internalError(res, 'Failed to get health summary: ', err.stack)
    })
}

function getHealthLogs(req, res) {
  if (!requireAdmin(req, res)) {
    return
  }
  var params = req.swagger.params
  dbapi.loadHealthLogs({
    query: params.q.value
  , priority: params.priority.value
  , serial: params.serial.value
  , limit: params.limit.value
  })
    .then(function(logs) {
      apiutil.respond(res, 200, 'Health logs', {logs: logs})
    })
    .catch(function(err) {
      apiutil.internalError(res, 'Failed to get health logs: ', err.stack)
    })
}

module.exports = {
  getHealthSummary: getHealthSummary
, getHealthLogs: getHealthLogs
}
