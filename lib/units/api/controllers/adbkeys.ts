// Key contents must never be logged or returned.
import apiutil from '../../../util/apiutil.js'
import adbkeysutil from '../../../util/adbkeysutil.js'
import logger from '../../../util/logger.js'
import type {Response} from 'express'
import type {ApiRequest} from '../../../types/units-api.js'

var log = logger.createLogger('api:controllers:adbkeys')

function forbidden(req: ApiRequest, res: Response) {
  // The admin tag is only enforced on the access token path, not on browser sessions
  if (req.user.privilege === apiutil.USER) {
    apiutil.respond(res, 403, 'Forbidden: privileged operation (admin)')
    return true
  }
  return false
}

async function withDir(req: ApiRequest, res: Response, fn: (dir: string) => Promise<void>) {
  var dir = req.options.adbKeysDir
  if (!dir) {
    return apiutil.respond(res, 503, 'Service Unavailable: no ADB keys directory configured')
  }
  try {
    await fn(dir)
  }
  catch (err) {
    var e = err as {status?: number, code?: string, message?: string}
    if (e.status) {
      return apiutil.respond(res, e.status, e.message)
    }
    return apiutil.internalError(res, 'ADB keys operation failed: %s', e.code || e.message)
  }
}

function getAdbKeys(req: ApiRequest, res: Response) {
  if (forbidden(req, res)) {
    return
  }
  if (!req.options.adbKeysDir) {
    return apiutil.respond(res, 200, 'ADB keys directory not configured', {
      configured: false
    , keys: []
    })
  }
  return withDir(req, res, async function(dir) {
    var keys = await adbkeysutil.list(dir)
    apiutil.respond(res, 200, 'ADB Keys Information', {configured: true, keys: keys})
  })
}

function addAdbKey(req: ApiRequest<{name: string, key: string}>, res: Response) {
  if (forbidden(req, res)) {
    return
  }
  return withDir(req, res, async function(dir) {
    var key = await adbkeysutil.add(dir, req.body.name, req.body.key)
    log.important('Admin %s added ADB key "%s" (%s)', req.user.email, key.name, key.fingerprint)
    apiutil.respond(res, 201, 'Created (key)', {key: key})
  })
}

function deleteAdbKey(req: ApiRequest, res: Response) {
  if (forbidden(req, res)) {
    return
  }
  var name = String(req.swagger.params.name?.value)
  return withDir(req, res, async function(dir) {
    await adbkeysutil.remove(dir, name)
    log.important('Admin %s deleted ADB key "%s"', req.user.email, name)
    apiutil.respond(res, 200, 'Deleted (key)')
  })
}

export {getAdbKeys, addAdbKey, deleteAdbKey}
