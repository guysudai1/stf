var http = require('http')
var URL = require('url').URL
var EventEmitter = require('events')
var missionStore = require('./mission-store')
var schedulerModule = require('./scheduler')
var adapters = require('./adapters')

function json(res, status, body) {
  var payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*'
  })
  res.end(payload)
}

function errorResponse(res, status, message) {
  json(res, status, {error: message})
}

function noContent(res) {
  res.writeHead(204, {'Access-Control-Allow-Origin': '*'})
  res.end()
}

function readBody(req, limit) {
  limit = limit || 1024 * 1024
  return new Promise(function(resolve, reject) {
    var chunks = []
    var length = 0
    req.on('data', function(chunk) {
      length += chunk.length
      if (length > limit) {
        reject(new Error('Request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', function() {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      }
      catch (err) {
        reject(new Error('Request body must be valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function writeEvent(res, event, payload) {
  res.write('event: ' + event + '\n')
  res.write('data: ' + JSON.stringify(payload) + '\n\n')
}

function createAgentBoard(options) {
  options = options || {}
  var store = options.store || new missionStore.MissionStore({filePath: options.filePath})
  var configuredAdapters = Object.assign({
    demo: adapters.createDemoWorker(options.demo),
    command: adapters.createCommandAdapter({command: process.env.AGENT_BOARD_COMMAND}),
    codex: adapters.createCodexAdapter(options.codex)
  }, options.adapters || {})
  var scheduler = options.scheduler || new schedulerModule.MissionScheduler({
    store: store,
    workers: options.workers !== undefined ? options.workers : options.workerCount,
    pollInterval: options.pollInterval,
    adapters: configuredAdapters
  })
  var clients = new Set()
  var events = new EventEmitter()

  function broadcast(event, payload) {
    clients.forEach(function(client) {
      writeEvent(client, event, payload)
    })
    events.emit(event, payload)
  }

  function onChange(change) {
    broadcast('mission', change)
  }
  store.on('change', onChange)

  var server = http.createServer(function(req, res) {
    var requestUrl = new URL(req.url, 'http://127.0.0.1')
    var pathname = requestUrl.pathname
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      json(res, 200, {ok: true, workers: scheduler.workerCount,
        running: scheduler._active.size})
      return
    }
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      })
      clients.add(res)
      writeEvent(res, 'ready', {ok: true})
      req.on('close', function() {
        clients.delete(res)
      })
      return
    }

    var missionMatch = pathname.match(/^\/api\/missions\/([^/]+)(?:\/(cancel|retry))?$/)
    if (req.method === 'GET' && pathname === '/api/missions') {
      store.list({status: requestUrl.searchParams.get('status') || undefined})
        .then(function(missions) { json(res, 200, {missions: missions}) })
        .catch(function(err) { errorResponse(res, 500, err.message) })
      return
    }
    if (req.method === 'POST' && pathname === '/api/missions') {
      readBody(req).then(function(body) {
        return store.create(body)
      }).then(function(mission) {
        json(res, 201, mission)
      }).catch(function(err) {
        errorResponse(res, err.message === 'Request body must be valid JSON' ? 400 : 422,
          err.message)
      })
      return
    }
    if (missionMatch) {
      var missionId = decodeURIComponent(missionMatch[1])
      var action = missionMatch[2]
      if (req.method === 'GET' && !action) {
        store.get(missionId).then(function(mission) {
          mission ? json(res, 200, mission) : errorResponse(res, 404, 'Mission not found')
        }).catch(function(err) { errorResponse(res, 400, err.message) })
        return
      }
      if (req.method === 'POST' && action === 'cancel') {
        scheduler.cancel(missionId).then(function(mission) {
          mission ? json(res, 200, mission) : errorResponse(res, 409, 'Mission is not queued')
        }).catch(function(err) { errorResponse(res, 404, err.message) })
        return
      }
      if (req.method === 'POST' && action === 'retry') {
        scheduler.retry(missionId).then(function(mission) {
          mission ? json(res, 200, mission) : errorResponse(res, 404, 'Mission not found')
        }).catch(function(err) { errorResponse(res, 409, err.message) })
        return
      }
    }
    if (req.method === 'DELETE' && missionMatch && !missionMatch[2]) {
      store.remove(decodeURIComponent(missionMatch[1])).then(function(removed) {
        removed ? noContent(res) : errorResponse(res, 404, 'Mission not found')
      }).catch(function(err) { errorResponse(res, 409, err.message) })
      return
    }
    errorResponse(res, 404, 'Not found')
  })

  return {
    server: server,
    store: store,
    scheduler: scheduler,
    events: events,
    start: function() { return scheduler.start().then(function() { return server }) },
    close: function() {
      store.removeListener('change', onChange)
      clients.forEach(function(client) { client.end() })
      clients.clear()
      return scheduler.stop().then(function() {
        return new Promise(function(resolve) {
          if (!server.listening) {
            resolve()
            return
          }
          server.close(resolve)
        })
      })
    }
  }
}

function createServer(options) {
  return createAgentBoard(options).server
}

module.exports = {
  createAgentBoard: createAgentBoard,
  createServer: createServer,
  readBody: readBody,
  writeEvent: writeEvent
}
