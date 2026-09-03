var childProcess = require('child_process')
var EventEmitter = require('events')
var WebSocket = require('ws')

function parseArgs(value) {
  if (!value) return []
  try {
    var parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(String)
  }
  catch (err) {
    // Fall back to the documented whitespace-separated form.
  }
  return value.trim() ? value.trim().split(/\s+/) : []
}

// Kept for callers that used the pre-WebSocket bridge directly.
function parseIncomingLine(line, allowedSender) {
  var value = String(line || '').trim()
  var match = value.match(/^<([^\s>]+)>\s+(.+)$/) ||
    value.match(/^([^\s:>]+)[:>]\s+(.+)$/)
  if (!match || !allowedSender || match[1].toLowerCase() !== allowedSender.toLowerCase()) {
    return null
  }
  return parseCommand(match[2].trim())
}

function parseCommand(message) {
  if (/^\/help$/i.test(message)) return {type: 'help'}
  if (/^\/status$/i.test(message)) return {type: 'status'}
  var mission = message.match(/^\/mission\s+(.+?)\s*(?:::|\|)\s*(.+)$/i)
  if (mission) {
    return {type: 'mission', title: mission[1].trim(), prompt: mission[2].trim()}
  }
  return {type: 'message', message: message}
}

function responseOf(payload) {
  return payload && payload.resp && typeof payload.resp === 'object' ? payload.resp : null
}

function firstValue(values) {
  for (var i = 0; i < values.length; i += 1) {
    if (values[i] !== undefined && values[i] !== null && values[i] !== '') return values[i]
  }
  return null
}

function contactOf(item) {
  var chatInfo = item && (item.chatInfo || item.chat || item.conversation)
  return (item && item.contact) || (chatInfo && chatInfo.contact) ||
    (chatInfo && chatInfo.type === 'contact' ? chatInfo : null)
}

function contactIdOf(item) {
  var contact = contactOf(item)
  return firstValue([contact && contact.contactId, contact && contact.id,
    item && item.contactId, item && item.chatItem && item.chatItem.contactId])
}

function contactNameOf(item) {
  var contact = contactOf(item)
  return firstValue([contact && contact.localDisplayName, contact && contact.displayName,
    contact && contact.name, item && item.sender, item && item.senderName])
}

function textOf(content) {
  if (!content || typeof content !== 'object') return null
  if (content.type === 'text' && typeof content.text === 'string') return content.text
  if (typeof content.text === 'string' && content.type !== 'file') return content.text
  return textOf(content.msgContent) || textOf(content.content) || textOf(content.message)
}

function messageTextOf(item) {
  var chatItem = item && item.chatItem && typeof item.chatItem === 'object' ? item.chatItem : item
  return textOf(chatItem && chatItem.content) || textOf(item && item.content)
}

function itemIdOf(item) {
  var chatItem = item && item.chatItem && typeof item.chatItem === 'object' ? item.chatItem : item
  var meta = chatItem && chatItem.meta
  return firstValue([item && item.chatItemId, chatItem && chatItem.chatItemId,
    chatItem && chatItem.itemId, chatItem && chatItem.id, meta && meta.itemId,
    meta && meta.chatItemId])
}

function isReceived(item) {
  var chatItem = item && item.chatItem && typeof item.chatItem === 'object' ? item.chatItem : item
  var direction = String(firstValue([item && item.chatDir, item && item.direction,
    chatItem && chatItem.chatDir, chatItem && chatItem.direction]) || '').toLowerCase()
  return !direction || direction.indexOf('rcv') !== -1 || direction.indexOf('receiv') !== -1
}

function normalizeIncomingEvent(payload, allowedSender, allowedContactId) {
  var response = responseOf(payload)
  if (!response || String(response.type || '').toLowerCase() !== 'newchatitems') return []
  var items = Array.isArray(response.chatItems) ? response.chatItems : []
  return items.reduce(function(result, item) {
    var text = messageTextOf(item)
    var sender = contactNameOf(item)
    var contactId = contactIdOf(item)
    if (!text || !isReceived(item)) return result
    if (allowedContactId && String(contactId) !== String(allowedContactId)) return result
    if (allowedSender && (!sender || sender.toLowerCase() !== allowedSender.toLowerCase())) return result
    var command = parseCommand(text.trim())
    command.messageId = itemIdOf(item)
    command.contactId = contactId
    command.sender = sender
    result.push(command)
    return result
  }, [])
}

function hasPort(args) {
  return args.some(function(arg) { return arg === '-p' || arg === '--chat-server-port' })
}

function SimplexBridge(options) {
  EventEmitter.call(this)
  options = options || {}
  this.command = options.command || process.env.SIMPLEX_CHAT_COMMAND || 'simplex-chat'
  this.args = options.args || parseArgs(process.env.SIMPLEX_CHAT_ARGS_JSON ||
    process.env.SIMPLEX_CHAT_ARGS)
  this.contact = options.contact || process.env.SIMPLEX_CHAT_CONTACT || ''
  this.allowedSender = options.allowedSender || process.env.SIMPLEX_CHAT_ALLOWED_SENDER ||
    this.contact
  this.contactId = options.contactId || process.env.SIMPLEX_CHAT_CONTACT_ID || null
  this.enabled = options.enabled !== undefined ? options.enabled :
    process.env.SIMPLEX_CHAT_ENABLED === '1'
  this.port = Number(options.port || process.env.SIMPLEX_CHAT_PORT || 5225)
  this.host = options.host || '127.0.0.1'
  this.connectTimeout = Number(options.connectTimeout || 5000)
  this.reconnectMin = Number(options.reconnectMin || 250)
  this.reconnectMax = Number(options.reconnectMax || 10000)
  this.childProcess = options.childProcess || childProcess
  this.WebSocket = options.WebSocket || WebSocket
  this.resolveContact = options.resolveContact !== false
  this.child = null
  this.socket = null
  this.statusValue = this.enabled ? 'starting' : 'disabled'
  this.error = null
  this._stopped = false
  this._reconnectTimer = null
  this._reconnectAttempt = 0
  this._connectTimer = null
  this._corrId = 0
  this._pending = new Map()
  this._outbox = []
  this._seen = new Set()
}

SimplexBridge.prototype = Object.create(EventEmitter.prototype)
SimplexBridge.prototype.constructor = SimplexBridge

SimplexBridge.prototype._setStatus = function(status, error) {
  this.statusValue = status
  if (error) this.error = error.message || String(error)
  this.emit('status', this.status())
}

SimplexBridge.prototype.start = function() {
  if (!this.enabled) return Promise.resolve(this)
  if (!this.contact) {
    this._setStatus('misconfigured', new Error('SIMPLEX_CHAT_CONTACT is required'))
    return Promise.resolve(this)
  }
  this._stopped = false
  this._ensureProcess()
  return Promise.resolve(this)
}

SimplexBridge.prototype._ensureProcess = function() {
  var that = this
  if (this._stopped || this.child) return
  var args = this.args.slice()
  if (!hasPort(args)) args = args.concat(['--chat-server-port', String(this.port)])
  try {
    this.child = this.childProcess.spawn(this.command, args, {stdio: ['ignore', 'pipe', 'pipe']})
  }
  catch (err) {
    this._transportFailure(err)
    return
  }
  this.child.stdout && this.child.stdout.on('data', function(chunk) { that.emit('log', chunk.toString()) })
  this.child.stderr && this.child.stderr.on('data', function(chunk) { that.emit('log', chunk.toString()) })
  this.child.on('error', function(err) { that._transportFailure(err) })
  this.child.on('close', function(code) {
    that.child = null
    if (!that._stopped) that._transportFailure(new Error('simplex-chat exited with code ' + code))
  })
  this._connectSocket()
}

SimplexBridge.prototype._connectSocket = function() {
  var that = this
  if (this._stopped || this.socket) return
  var socket
  try {
    socket = new this.WebSocket('ws://' + this.host + ':' + this.port)
  }
  catch (err) {
    this._transportFailure(err)
    return
  }
  this.socket = socket
  this._connectTimer = setTimeout(function() {
    that._transportFailure(new Error('SimpleX WebSocket connection timed out'))
  }, this.connectTimeout)
  socket.on('open', function() {
    clearTimeout(that._connectTimer)
    that._connectTimer = null
    that._initialize().then(function() {
      that._reconnectAttempt = 0
      that.error = null
      that._setStatus('connected')
      that._flush()
    }).catch(function(err) { that._transportFailure(err) })
  })
  socket.on('message', function(data) { that._onMessage(data) })
  socket.on('error', function(err) { that.emit('log', 'SimpleX WebSocket error: ' + err.message) })
  socket.on('close', function() {
    if (that.socket === socket) that.socket = null
    if (!that._stopped) that._transportFailure(new Error('SimpleX WebSocket closed'))
  })
}

SimplexBridge.prototype._initialize = function() {
  var that = this
  if (!this.resolveContact || this.contactId) return Promise.resolve()
  return this._request('/user').then(function(result) {
    var user = result && result.user
    var userId = user && (user.userId || user.id)
    if (!userId) throw new Error('SimpleX active user was not returned')
    return that._request('/_contacts ' + userId)
  }).then(function(result) {
    var contacts = result && (result.contacts || result.items)
    contacts = Array.isArray(contacts) ? contacts : []
    var matches = contacts.filter(function(contact) {
      var name = firstValue([contact.localDisplayName, contact.displayName, contact.name])
      return name && name.toLowerCase() === that.allowedSender.toLowerCase()
    })
    if (matches.length !== 1) {
      throw new Error('SimpleX contact is not uniquely resolved for ' + that.allowedSender)
    }
    that.contactId = matches[0].contactId || matches[0].id
    if (!that.contactId) throw new Error('Resolved SimpleX contact has no ID')
  })
}

SimplexBridge.prototype._onMessage = function(data) {
  var payload
  try {
    payload = JSON.parse(data.toString())
  }
  catch (err) {
    this.emit('log', 'Ignoring malformed SimpleX WebSocket message')
    return
  }
  var response = responseOf(payload)
  if (payload.corrId && this._pending.has(String(payload.corrId))) {
    var pending = this._pending.get(String(payload.corrId))
    this._pending.delete(String(payload.corrId))
    if (response && String(response.type || '').toLowerCase() === 'chatcmderror') {
      var errorType = response.chatError && response.chatError.errorType
      pending.reject(new Error(errorType && errorType.message || 'SimpleX command failed'))
    }
    else pending.resolve(response)
  }
  normalizeIncomingEvent(payload, this.allowedSender, this.contactId).forEach(this._emitIncoming.bind(this))
}

SimplexBridge.prototype._emitIncoming = function(command) {
  if (command.messageId) {
    if (this._seen.has(String(command.messageId))) return
    this._seen.add(String(command.messageId))
    if (this._seen.size > 2000) this._seen.delete(this._seen.values().next().value)
  }
  if (command.contactId && !this.contactId) this.contactId = command.contactId
  this.emit(command.type, command)
  this.emit('log', 'Received SimpleX command from ' + (command.sender || 'authorized contact'))
}

SimplexBridge.prototype._request = function(command) {
  var that = this
  if (!this.socket || this.socket.readyState !== this.WebSocket.OPEN) {
    return Promise.reject(new Error('SimpleX WebSocket is not connected'))
  }
  var corrId = String(++this._corrId)
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      that._pending.delete(corrId)
      reject(new Error('SimpleX command timed out'))
    }, that.connectTimeout)
    that._pending.set(corrId, {
      resolve: function(value) { clearTimeout(timer); resolve(value) },
      reject: function(err) { clearTimeout(timer); reject(err) }
    })
    try {
      that.socket.send(JSON.stringify({corrId: corrId, cmd: command}))
    }
    catch (err) {
      that._pending.delete(corrId)
      clearTimeout(timer)
      reject(err)
    }
  })
}

SimplexBridge.prototype._flush = function() {
  var that = this
  if (this.statusValue !== 'connected' || !this._outbox.length) return
  var request = this._outbox.shift()
  this._request('/_send @' + (this.contactId || this.contact) + ' text ' + request.message)
    .then(request.resolve)
    .catch(function(err) {
      if (!that._stopped && that.statusValue !== 'connected') that._outbox.unshift(request)
      else request.reject(err)
    })
    .then(function() { that._flush() })
}

SimplexBridge.prototype.send = function(message) {
  var that = this
  if (!this.enabled || this._stopped) return Promise.reject(new Error('SimpleX bridge is not connected'))
  return new Promise(function(resolve, reject) {
    that._outbox.push({message: String(message).replace(/[\r\n]+/g, ' '), resolve: resolve, reject: reject})
    that._flush()
  })
}

SimplexBridge.prototype._transportFailure = function(err) {
  if (this._stopped) return
  this.error = err.message || String(err)
  this._setStatus('reconnecting', err)
  if (this.socket) {
    var socket = this.socket
    this.socket = null
    try { socket.close() }
    catch (closeErr) { /* already closed */ }
  }
  this._pending.forEach(function(pending) { pending.reject(err) })
  this._pending.clear()
  if (this._reconnectTimer) return
  var delay = Math.min(this.reconnectMax, this.reconnectMin * Math.pow(2, this._reconnectAttempt++))
  this._reconnectTimer = setTimeout(function() {
    this._reconnectTimer = null
    this._ensureProcess()
    this._connectSocket()
  }.bind(this), delay)
}

SimplexBridge.prototype.status = function() {
  return {enabled: this.enabled, status: this.statusValue, contact: this.contact || null,
    contactId: this.contactId || null, error: this.error}
}

SimplexBridge.prototype.notifyMission = function(mission) {
  if (!mission || !this.enabled) return Promise.resolve()
  var message
  if (mission.status === 'queued') message = 'Mission queued: ' + mission.title + ' [' + mission.id + ']'
  else if (mission.status === 'running') message = 'Mission started: ' + mission.title + ' [' + mission.id + ']'
  else if (mission.status === 'completed') message = 'Mission completed: ' + mission.title + ' [' + mission.id + ']'
  else if (mission.status === 'failed') message = 'Mission blocked: ' + mission.title + ' [' + mission.id + '] - ' + mission.error
  else if (mission.status === 'cancelled') message = 'Mission cancelled: ' + mission.title + ' [' + mission.id + ']'
  return message ? this.send(message).catch(function() {}) : Promise.resolve()
}

SimplexBridge.prototype.close = function() {
  this._stopped = true
  this._setStatus('stopped')
  if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
  if (this._connectTimer) clearTimeout(this._connectTimer)
  this._reconnectTimer = null
  this._connectTimer = null
  this._outbox.splice(0).forEach(function(request) {
    request.reject(new Error('SimpleX bridge is stopped'))
  })
  this._pending.forEach(function(pending) { pending.reject(new Error('SimpleX bridge is stopped')) })
  this._pending.clear()
  if (this.socket) {
    try { this.socket.close() }
    catch (err) { /* already closed */ }
    this.socket = null
  }
  if (this.child) {
    this.child.kill('SIGTERM')
    this.child = null
  }
  return Promise.resolve()
}

module.exports = {
  SimplexBridge: SimplexBridge,
  createSimplexBridge: function(options) { return new SimplexBridge(options) },
  parseArgs: parseArgs,
  parseIncomingLine: parseIncomingLine,
  normalizeIncomingEvent: normalizeIncomingEvent
}
