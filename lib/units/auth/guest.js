/**
* Copyright © 2026 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
**/

var http = require('http')

var express = require('express')
var cookieSession = require('cookie-session')
var bodyParser = require('body-parser')
var serveStatic = require('serve-static')
var csrf = require('@dr.pogodin/csurf')
var Promise = require('bluebird')
var uuid = require('uuid')

var logger = require('../../util/logger')
var requtil = require('../../util/requtil')
var jwtutil = require('../../util/jwtutil')
var pathutil = require('../../util/pathutil')
var urlutil = require('../../util/urlutil')
var lifecycle = require('../../util/lifecycle')

const dbapi = require('../../db/api')

module.exports = function(options) {
  var log = logger.createLogger('auth-guest')
  var app = express()
  var server = Promise.promisifyAll(http.createServer(app))

  lifecycle.observe(function() {
    log.info('Waiting for client connections to end')
    return server.closeAsync()
      .catch(function() {
        // Okay
      })
  })

  app.set('view engine', 'pug')
  app.set('views', pathutil.resource('auth/guest/views'))
  app.set('strict routing', true)
  app.set('case sensitive routing', true)

  app.use(cookieSession({
    name: options.ssid
  , keys: [options.secret]
  }))
  app.use(bodyParser.json())
  app.use(csrf())
  app.use('/static/bower_components',
    serveStatic(pathutil.resource('bower_components')))
  app.use('/static/auth/guest', serveStatic(pathutil.resource('auth/guest')))

  app.use(function(req, res, next) {
    res.cookie('XSRF-TOKEN', req.csrfToken())
    next()
  })

  app.disable('x-powered-by')

  app.get('/', function(req, res) {
    res.redirect('/auth/guest/')
  })

  app.get('/auth/contact', function(req, res) {
    dbapi.getRootGroup().then(function(group) {
      res.status(200).json({
        success: true
      , contact: group.owner
      })
    }).catch(function(err) {
      log.error('Unexpected error', err.stack)
      res.status(500).json({
        success: false
      , error: 'ServerError'
      })
    })
  })

  app.get('/auth/guest/', function(req, res) {
    if (!req.session.guestId) {
      req.session.guestId = 'guest-' + uuid.v4().replace(/-/g, '')
    }
    res.render('index')
  })

  app.post('/auth/api/v1/guest', requtil.validators.guestNicknameValidator,
    function(req, res) {
      switch (req.accepts(['json'])) {
        case 'json':
          requtil.validate(req)
            .then(function() {
              var guestId = req.session.guestId ||
                'guest-' + uuid.v4().replace(/-/g, '')
              req.session.guestId = guestId
              var email = guestId + '@guest.local'
              return dbapi.saveUserAfterLogin({
                name: req.body.name
              , email: email
              , ip: req.ip
              }).then(function(saved) {
                if (!saved) {
                  return Promise.reject('NicknameAlreadySet')
                }
                return {
                  email: email
                , name: req.body.name
                }
              })
            })
            .then(function(user) {
              var token = jwtutil.encode({
                payload: {
                  email: user.email
                , name: user.name
                }
              , secret: options.secret
              , header: {
                  exp: Date.now() + 24 * 3600
                }
              })
              res.status(200).json({
                success: true
              , redirect: urlutil.addParams(options.appUrl, {jwt: token})
              })
            })
            .catch(requtil.ValidationError, function(err) {
              res.status(400).json({
                success: false
              , error: 'ValidationError'
              , validationErrors: err.errors
              })
            })
            .catch(function(err) {
              if (err === 'NicknameAlreadySet') {
                res.status(409).json({
                  success: false
                , error: 'NicknameAlreadySet'
                })
                return
              }
              throw err
            })
            .catch(function(err) {
              log.error('Unexpected error', err.stack || err)
              res.status(500).json({
                success: false
              , error: 'ServerError'
              })
            })
          break
        default:
          res.send(406)
          break
      }
    })

  server.listen(options.port)
  log.info('Listening on port %d', options.port)
}
