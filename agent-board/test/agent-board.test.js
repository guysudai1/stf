var assert = require('assert/strict')
var fs = require('fs')
var os = require('os')
var path = require('path')
var http = require('http')
var EventEmitter = require('events')
var WebSocket = require('ws')
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

test('SimpleX bridge accepts commands only from the configured contact', function() {
  assert.deepEqual(board.parseIncomingLine('alice: /mission Build tests :: run the unit suite', 'alice'), {
    type: 'mission', title: 'Build tests', prompt: 'run the unit suite'
  })
  assert.deepEqual(board.parseIncomingLine('alice: /status', 'alice'), {type: 'status'})
  assert.deepEqual(board.parseIncomingLine('alice: /help', 'alice'), {type: 'help'})
  assert.equal(board.parseIncomingLine('mallory: /mission Exfil :: do it', 'alice'), null)
  assert.deepEqual(board.parseIncomingLine('alice: hello there', 'alice'), {
    type: 'message', message: 'hello there'
  })
})

test('SimpleX WebSocket events normalize authorized text and reject duplicates upstream', function() {
  var event = {resp: {type: 'newChatItems', chatItems: [{
    chatDir: 'directRcv',
    contact: {contactId: 7, localDisplayName: 'Alice'},
    chatItem: {chatItemId: 42, content: {type: 'rcvMsgContent',
      msgContent: {type: 'text', text: '/mission Build tests :: run the unit suite'}}}
  }, {
    chatDir: 'directRcv',
    contact: {contactId: 8, localDisplayName: 'Mallory'},
    chatItem: {chatItemId: 43, content: {type: 'rcvMsgContent',
      msgContent: {type: 'text', text: '/mission Exfil :: do it'}}}
  }]}}
  assert.deepEqual(board.normalizeIncomingEvent(event, 'Alice', 7), [{
    type: 'mission', title: 'Build tests', prompt: 'run the unit suite',
    messageId: 42, contactId: 7, sender: 'Alice'
  }])
  assert.deepEqual(board.normalizeIncomingEvent(event, 'Alice'), [{
    type: 'mission', title: 'Build tests', prompt: 'run the unit suite',
    messageId: 42, contactId: 7, sender: 'Alice'
  }])
})

test('SimpleX bridge receives realtime events and correlates outbound sends', async function() {
  var websocketServer = new WebSocket.Server({host: '127.0.0.1', port: 0})
  await new Promise(function(resolve) { websocketServer.once('listening', resolve) })
  var sentCommand
  websocketServer.on('connection', function(socket) {
    socket.on('message', function(raw) {
      var request = JSON.parse(raw.toString())
      sentCommand = request.cmd
      socket.send(JSON.stringify({corrId: request.corrId, resp: {type: 'cmdOk'}}))
    })
  })
  var child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = function() {}
  var bridge = new board.SimplexBridge({enabled: true, contact: 'Alice', allowedSender: 'Alice',
    contactId: 7, port: websocketServer.address().port, resolveContact: false,
    childProcess: {spawn: function() { return child }}})
  var connected = new Promise(function(resolve) { bridge.once('status', function(status) {
    if (status.status === 'connected') resolve()
  }) })
  await bridge.start()
  await connected
  var received = new Promise(function(resolve) { bridge.once('mission', resolve) })
  bridge._onMessage(JSON.stringify({resp: {type: 'newChatItems', chatItems: [{
    chatDir: 'directRcv', contact: {contactId: 7, localDisplayName: 'Alice'},
    chatItem: {chatItemId: 99, content: {type: 'rcvMsgContent',
      msgContent: {type: 'text', text: '/mission Live :: test'}}}
  }]}}))
  assert.equal((await received).title, 'Live')
  await bridge.send('ACK')
  assert.equal(sentCommand, '/_send @7 text ACK')
  await bridge.close()
  await new Promise(function(resolve) { websocketServer.close(resolve) })
})

test('SimpleX bridge reconnects after the WebSocket is closed', async function() {
  var websocketServer = new WebSocket.Server({host: '127.0.0.1', port: 0})
  await new Promise(function(resolve) { websocketServer.once('listening', resolve) })
  var connections = 0
  websocketServer.on('connection', function(socket) {
    connections += 1
    if (connections === 1) setTimeout(function() { socket.close() }, 10)
  })
  var child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = function() {}
  var bridge = new board.SimplexBridge({enabled: true, contact: 'Alice', contactId: 7,
    port: websocketServer.address().port, resolveContact: false, reconnectMin: 10,
    reconnectMax: 20, childProcess: {spawn: function() { return child }}})
  var connected = 0
  bridge.on('status', function(status) {
    if (status.status === 'connected') connected += 1
  })
  await bridge.start()
  await new Promise(function(resolve, reject) {
    var timer = setInterval(function() {
      if (connected >= 2) {
        clearInterval(timer)
        resolve()
      }
    }, 10)
    setTimeout(function() {
      clearInterval(timer)
      reject(new Error('SimpleX bridge did not reconnect'))
    }, 1000)
  })
  assert.ok(connections >= 2)
  await bridge.close()
  await new Promise(function(resolve) { websocketServer.close(resolve) })
})

test('agent board responds to the SimpleX /help command', async function() {
  var temporary = temporaryFile()
  var simplex = new EventEmitter()
  var sent = []
  simplex.start = function() { return Promise.resolve() }
  simplex.close = function() { return Promise.resolve() }
  simplex.status = function() { return {enabled: true, status: 'connected'} }
  simplex.send = function(message) { sent.push(message); return Promise.resolve() }
  var application = board.createAgentBoard({filePath: temporary.filePath, pollInterval: 0, simplex: simplex})
  await application.start()
  simplex.emit('help')
  await new Promise(function(resolve) { setImmediate(resolve) })
  assert.equal(sent[0], 'ACK: available commands: /mission Title :: detailed prompt | /status | /help')
  await application.close()
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
