var assert = require('assert/strict')
var fs = require('fs')
var os = require('os')
var path = require('path')
var http = require('http')
var test = require('node:test')
var board = require('..')

function temporaryFile() {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stf-agent-board-'))
  return {directory: directory, filePath: path.join(directory, 'missions.json')}
}

function request(server, method, pathname, body) {
  return new Promise(function(resolve, reject) {
    var address = server.address()
    var request = http.request({hostname: '127.0.0.1', port: address.port, method: method,
      path: pathname, headers: {'Content-Type': 'application/json'}}, function(response) {
      var chunks = []
      response.on('data', function(chunk) { chunks.push(chunk) })
      response.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8')
        resolve({statusCode: response.statusCode, body: text ? JSON.parse(text) : null})
      })
    })
    request.on('error', reject)
    if (body) {
      request.write(JSON.stringify(body))
    }
    request.end()
  })
}

test('JSON mission store persists missions and status transitions', async function() {
  var temporary = temporaryFile()
  var store = new board.MissionStore({filePath: temporary.filePath, idFactory: function() {
    return 'mission-1'
  }, clock: function() { return '2026-01-01T00:00:00.000Z' }})
  var mission = await store.create({title: 'Persist me', prompt: 'hello'})
  assert.equal(mission.id, 'mission-1')
  assert.equal((await store.claim(mission.id, 'worker-1')).status, 'running')
  assert.equal((await store.transition(mission.id, 'completed', {result: 'done'})).result, 'done')

  var reopened = new board.MissionStore({filePath: temporary.filePath})
  assert.equal((await reopened.get('mission-1')).status, 'completed')
  assert.equal((await reopened.list()).length, 1)
})

test('scheduler honors worker count and routes demo work', async function() {
  var temporary = temporaryFile()
  var store = new board.MissionStore({filePath: temporary.filePath})
  var running = 0
  var maximum = 0
  var scheduler = new board.MissionScheduler({store: store, workers: 2, pollInterval: 0,
    adapters: {demo: function(mission) {
      running += 1
      maximum = Math.max(maximum, running)
      return new Promise(function(resolve) {
        setTimeout(function() {
          running -= 1
          resolve(mission.title)
        }, 20)
      })
    }}})
  await scheduler.start()
  await Promise.all([store.create({title: 'one', prompt: '1'}),
    store.create({title: 'two', prompt: '2'}), store.create({title: 'three', prompt: '3'})])
  await new Promise(function(resolve) {
    var interval = setInterval(async function() {
      var missions = await store.list()
      if (missions.every(function(mission) { return mission.status === 'completed' })) {
        clearInterval(interval)
        resolve()
      }
    }, 10)
  })
  assert.equal(maximum, 2)
  await scheduler.stop()
})

test('command adapter captures output and reports non-zero exits', async function() {
  var adapter = board.createCommandAdapter({command: '/bin/sh', args: ['-c', 'printf ok']})
  var result = await adapter({id: 'command-1'}, {})
  assert.equal(result.stdout, 'ok')

  var failing = board.createCommandAdapter({command: '/bin/sh',
    args: ['-c', 'printf bad >&2; exit 3']})
  await assert.rejects(failing({id: 'command-2'}, {}), /bad/)
})

test('scheduler cancellation prevents an active mission from being marked failed', async function() {
  var temporary = temporaryFile()
  var store = new board.MissionStore({filePath: temporary.filePath})
  var scheduler = new board.MissionScheduler({store: store, pollInterval: 0,
    adapters: {demo: function(mission, context) {
      return new Promise(function(resolve, reject) {
        var timer = setTimeout(resolve, 1000)
        context.signal.addEventListener('abort', function() {
          clearTimeout(timer)
          reject(new Error('aborted'))
        }, {once: true})
      })
    }}})
  await scheduler.start()
  var mission = await store.create({title: 'cancel me', prompt: 'wait'})
  await new Promise(function(resolve) { setTimeout(resolve, 10) })
  assert.equal((await scheduler.cancel(mission.id)).status, 'cancelled')
  await scheduler.stop()
  assert.equal((await store.get(mission.id)).status, 'cancelled')
})

test('HTTP API creates missions and publishes SSE changes', async function() {
  var temporary = temporaryFile()
  var application = board.createAgentBoard({filePath: temporary.filePath, pollInterval: 0,
    demo: {delay: 10}})
  await application.start()
  await new Promise(function(resolve) { application.server.listen(0, '127.0.0.1', resolve) })
  var address = application.server.address()
  var sse = await new Promise(function(resolve, reject) {
    var request = http.get({hostname: '127.0.0.1', port: address.port, path: '/api/events'},
      function(response) {
        response.once('data', function(chunk) { resolve({response: response, first: chunk.toString()}) })
      })
    request.on('error', reject)
  })
  assert.match(sse.first, /event: ready/)
  var created = await request(application.server, 'POST', '/api/missions',
    {title: 'API mission', prompt: 'run'})
  assert.equal(created.statusCode, 201)
  var fetched = await request(application.server, 'GET', '/api/missions/' + created.body.id)
  assert.equal(fetched.body.title, 'API mission')
  await new Promise(function(resolve) {
    sse.response.on('data', function(chunk) {
      if (chunk.toString().indexOf('"status":"completed"') !== -1) {
        resolve()
      }
    })
  })
  sse.response.destroy()
  await application.close()
})
