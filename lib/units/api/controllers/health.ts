import dbapi from '../../../db/api.js'
import apiutil from '../../../util/apiutil.js'
import healthlog from '../../../util/healthlog.js'
import type {Response} from 'express'
import type {ApiRequest} from '../../../types/units-api.js'

function forbidden(req: ApiRequest, res: Response) {
  // The admin tag is only enforced on the access token path, not on browser sessions
  if (req.user.privilege === apiutil.USER) {
    apiutil.respond(res, 403, 'Forbidden: privileged operation (admin)')
    return true
  }
  return false
}

function getHealthSummary(req: ApiRequest, res: Response) {
  if (forbidden(req, res)) {
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

function getHealthLogs(req: ApiRequest, res: Response) {
  if (forbidden(req, res)) {
    return
  }
  var params = req.swagger.params
  dbapi.loadHealthLogs({
    query: params.q?.value
  , priority: params.priority?.value
  , serial: params.serial?.value
  , limit: params.limit?.value
  })
    .then(function(logs) {
      apiutil.respond(res, 200, 'Health logs', {
        logs: logs.map(healthlog.present)
      })
    })
    .catch(function(err) {
      apiutil.internalError(res, 'Failed to get health logs: ', err.stack)
    })
}

export {
  getHealthSummary
, getHealthLogs
}
