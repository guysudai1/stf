var http = require('http')
var fs = require('fs')
var path = require('path')
var URL = require('url').URL
var EventEmitter = require('events')
var missionStore = require('./mission-store')
var schedulerModule = require('./scheduler')
var adapters = require('./adapters')
var simplexModule = require('./simplex')

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

function contentType(filePath) {
  return {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'}[path.extname(filePath)] || 'application/octet-stream'
}

function createAgentBoard(options) {
  options = options || {}
  var store = options.store || new missionStore.MissionStore({filePath: options.filePath})
  var codexOptions = Object.assign({cwd: process.env.AGENT_WORKDIR || process.cwd()},
    options.codex || {})
  var configuredAdapters = Object.assign({
    demo: adapters.createDemoWorker(options.demo),
    codex: adapters.createCodexAdapter(codexOptions)
  }, options.adapters || {})
  if (process.env.AGENT_BOARD_COMMAND) {
    configuredAdapters.command = adapters.createCommandAdapter({
      command: process.env.AGENT_BOARD_COMMAND,
      cwd: process.env.AGENT_WORKDIR || process.cwd()
    })
  }
  var scheduler = options.scheduler || new schedulerModule.MissionScheduler({
    store: store,
    workers: options.workers !== undefined ? options.workers : options.workerCount,
    pollInterval: options.pollInterval,
    adapters: configuredAdapters
  })
  var simplex = options.simplex || simplexModule.createSimplexBridge(options.simplexOptions)
  var defaultAdapter = options.defaultAdapter || process.env.AGENT_RUNNER || 'demo'
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
    simplex.notifyMission(change.mission)
  }
  store.on('change', onChange)
  simplex.on('error', function(err) {
    broadcast('integration', {name: 'simplex', status: 'error', error: err.message})
  })
  simplex.on('mission', function(input) {
    store.create({title: input.title, prompt: input.prompt,
      adapter: process.env.SIMPLEX_CHAT_MISSION_ADAPTER || 'codex'})
      .catch(function(err) { simplex.send('Mission rejected: ' + err.message).catch(function() {}) })
  })
  simplex.on('status', function() {
    store.list().then(function(missions) {
      var summary = missions.map(function(mission) {
        return mission.id + ' ' + mission.status + ' ' + mission.title
      }).join('; ')
      return simplex.send(summary || 'No missions on the board')
    }).catch(function() {})
  })

  var server = http.createServer(function(req, res) {
    var requestUrl = new URL(req.url, 'http://127.0.0.1')
    var pathname = requestUrl.pathname
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
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
    if (req.method === 'GET' && pathname === '/api/integrations') {
      json(res, 200, {simplex: simplex.status()})
      return
    }
    if (req.method === 'GET' && (pathname === '/' || pathname === '/agent-board' ||
        pathname === '/agent-board/')) {
      serveStatic(res, path.join(__dirname, 'public', 'index.html'))
      return
    }
    if (req.method === 'GET' && (pathname.indexOf('/agent-board/') === 0 ||
        pathname === '/app.js' || pathname === '/styles.css')) {
      var asset = path.basename(pathname)
      if (asset === 'app.js' || asset === 'styles.css' || asset === 'index.html') {
        serveStatic(res, path.join(__dirname, 'public', asset))
        return
      }
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
    if (req.method === 'GET' && pathname === '/api/agents') {
      json(res, 200, {agents: scheduler.agents()})
      return
    }
    if (req.method === 'POST' && pathname === '/api/missions') {
      readBody(req).then(function(body) {
        if (!body.adapter) {
          body.adapter = defaultAdapter
        }
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
      if (req.method === 'PATCH' && !action) {
        readBody(req).then(function(body) {
          if (!body || body.status !== 'claimed') {
            throw new Error('Only claiming a queued mission is supported')
          }
          return scheduler.claim(missionId)
        }).then(function(mission) {
          mission ? json(res, 200, mission) : errorResponse(res, 404, 'Mission not found')
        }).catch(function(err) { errorResponse(res, 409, err.message) })
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
    var agentMatch = pathname.match(/^\/api\/agents\/([^/]+)\/stop$/)
    if (req.method === 'POST' && agentMatch) {
      scheduler.stopAgent(decodeURIComponent(agentMatch[1])).then(function(mission) {
        mission ? json(res, 200, mission) : errorResponse(res, 404, 'Agent is idle')
      }).catch(function(err) { errorResponse(res, 409, err.message) })
      return
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
    start: function() {
      return Promise.all([scheduler.start(), simplex.start()]).then(function() { return server })
    },
    close: function() {
      store.removeListener('change', onChange)
      clients.forEach(function(client) { client.end() })
      clients.clear()
      return scheduler.stop().then(function() { return simplex.close() }).then(function() {
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

function serveStatic(res, filePath) {
  fs.readFile(filePath, function(err, contents) {
    if (err) {
      errorResponse(res, 404, 'Not found')
      return
    }
    res.writeHead(200, {'Content-Type': contentType(filePath), 'Content-Length': contents.length})
    res.end(contents)
  })
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
