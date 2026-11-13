import http from 'http'

import express from 'express'
import cookieSession from 'cookie-session'
import bodyParser from 'body-parser'
import * as csurf from '@dr.pogodin/csurf'
var csrf = csurf.default || (csurf as unknown as typeof csurf.default)
import Promise from 'bluebird'
import * as uuid from 'uuid'

import logger from '../../util/logger.js'
import requtil from '../../util/requtil.js'
import jwtutil from '../../util/jwtutil.js'
import pathutil from '../../util/pathutil.js'
import urlutil from '../../util/urlutil.js'
import lifecycle from '../../util/lifecycle.js'
import cookieutil, {type CookieUnitOptions} from '../../util/cookieutil.js'
import {GUEST_DOMAIN, startCleanup} from './guest-cleanup.js'

import dbapi from '../../db/api.js'

interface GuestAuthOptions extends CookieUnitOptions {
  port: number
  secret: string
  ssid: string
  appUrl: string
}

function newGuestId() {
  return 'guest-' + uuid.v4().replace(/-/g, '')
}

export default function(options: GuestAuthOptions) {
  var log = logger.createLogger('auth-guest')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  cookieutil.warnIfInsecureSameSiteNone(options, log)

  var cleanup = startCleanup()

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    clearInterval(cleanup)
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/guest/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)
  if (cookieutil.needsProxyTrust(options)) {
    app.set('trust proxy', true)
  }

  app.use(cookieSession(cookieutil.sessionOptions({
    ssid: options.ssid
  , secret: options.secret
  , cookieSameSite: options.cookieSameSite
  , cookieSecure: options.cookieSecure
  })))
  app.use(bodyParser.json())
  app.use(csrf())

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken(), cookieutil.xsrfCookieOptions(options, req))
    next()
  })

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/guest/')
  })

  app.get('/auth/contact', function(req, res) {
    dbapi.getRootGroup().then(function(group) {
      res.status(200)
        .json({
          success: true
        , contact: group.owner
        })
    })
    .catch(function(err) {
      log.error('Unexpected error', err.stack)
      res.status(500)
        .json({
          success: false
        , error: 'ServerError'
        })
    })
  })

  app.post('/auth/api/v1/logout', function(req, res) {
    req.session = null
    res.json({
      success: true
    })
  })

  app.get('/auth/guest/', function(req, res) {
    if (!req.session!.guestId) {
      req.session!.guestId = newGuestId()
    }
    res.render('index')
  })

  app.post('/auth/api/v1/guest', requtil.validators.guestNicknameValidator, function(
    req: express.Request
  , res: express.Response
  ) {
    var log = logger.createLogger('auth-guest')
    log.setLocalIdentifier(req.ip)
    switch (req.accepts(['json'])) {
      case 'json':
        requtil.validate(req)
          .then(function() {
            var guestId = req.session!.guestId || newGuestId()
            req.session!.guestId = guestId
            var email = guestId + GUEST_DOMAIN
            return dbapi.saveUserAfterLogin({
              name: req.body.name
            , email: email
            , ip: req.ip!
            })
            .then(function(saved) {
              if (!saved) {
                return Promise.reject('NicknameAlreadySet')
              }
              return {email: email, name: req.body.name}
            })
          })
          .then(function(user) {
            log.info('Authenticated "%s"', user.email)
            var token = jwtutil.encode({
              payload: {
                email: user.email
              , name: user.name
              }
            , secret: options.secret
            , header: {
                exp: Date.now() + 24 * 3600 * 1000
              }
            })
            res.status(200)
              .json({
                success: true
              , redirect: urlutil.addParams(options.appUrl, {
                  jwt: token
                })
              })
          })
          .catch(requtil.ValidationError, function(err) {
            res.status(400)
              .json({
                success: false
              , error: 'ValidationError'
              , validationErrors: err.errors
              })
          })
          .catch(function(err) {
            if (err === 'NicknameAlreadySet') {
              res.status(409)
                .json({
                  success: false
                , error: 'NicknameAlreadySet'
                })
            }
            else {
              log.error('Unexpected error', err.stack || err)
              res.status(500)
                .json({
                  success: false
                , error: 'ServerError'
                })
            }
          })
        break
      default:
        res.sendStatus(406)
        break
    }
  })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
