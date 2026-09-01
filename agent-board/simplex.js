var childProcess = require('child_process')
var EventEmitter = require('events')

function parseArgs(value) {
  if (!value) {
    return []
  }
  try {
    var parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map(String)
    }
  }
  catch (err) {
    // Fall back to the documented whitespace-separated form.
  }
  return value.trim() ? value.trim().split(/\s+/) : []
}

function parseIncomingLine(line, allowedSender) {
  var value = String(line || '').trim()
  var match = value.match(/^<([^\s>]+)>\s+(.+)$/) ||
    value.match(/^([^\s:>]+)[:>]\s+(.+)$/)
  if (!match || !allowedSender || match[1].toLowerCase() !== allowedSender.toLowerCase()) {
    return null
  }
  var message = match[2].trim()
  if (/^\/status$/i.test(message)) {
    return {type: 'status'}
  }
  var mission = message.match(/^\/mission\s+(.+?)\s*(?:::|\|)\s*(.+)$/i)
  if (mission) {
    return {type: 'mission', title: mission[1].trim(), prompt: mission[2].trim()}
  }
  return {type: 'message', message: message}
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function stripAnsi(value) {
  return String(value).replace(/[\u001b\u009b]\[[0-?]*[ -/]*[@-~]/g, '')
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
  this.enabled = options.enabled !== undefined ? options.enabled :
    process.env.SIMPLEX_CHAT_ENABLED === '1'
  this.child = null
  this.usePty = options.usePty !== false
  this.ptyRows = Number(options.ptyRows || process.env.SIMPLEX_CHAT_PTY_ROWS || 40)
  this.ptyCols = Number(options.ptyCols || process.env.SIMPLEX_CHAT_PTY_COLS || 120)
  this.statusValue = this.enabled ? 'starting' : 'disabled'
  this.error = null
  this._buffer = ''
}

SimplexBridge.prototype = Object.create(EventEmitter.prototype)
SimplexBridge.prototype.constructor = SimplexBridge

SimplexBridge.prototype.start = function() {
  var that = this
  if (!this.enabled) {
    return Promise.resolve(this)
  }
  if (!this.contact) {
    this.statusValue = 'misconfigured'
    this.error = 'SIMPLEX_CHAT_CONTACT is required'
    return Promise.resolve(this)
  }
  try {
    var spawnCommand = this.command
    var spawnArgs = this.args
    if (this.usePty) {
      var commandLine = [this.command].concat(this.args).map(shellQuote).join(' ')
      spawnCommand = 'script'
      var resize = 'stty rows ' + this.ptyRows + ' cols ' + this.ptyCols + '; exec '
      spawnArgs = ['-qfec', resize + commandLine, '/dev/null']
    }
    this.child = childProcess.spawn(spawnCommand, spawnArgs, {stdio: ['pipe', 'pipe', 'pipe']})
  }
  catch (err) {
    this._recordError(err)
    return Promise.resolve(this)
  }
  this.statusValue = 'connected'
  this.child.stdout.on('data', function(chunk) { that._onOutput(chunk) })
  this.child.stderr.on('data', function(chunk) { that.emit('log', chunk.toString()) })
  this.child.on('error', function(err) { that._recordError(err) })
  this.child.on('close', function(code) {
    that.child = null
    if (that.statusValue !== 'stopped' && code !== 0) {
      that.statusValue = 'error'
      that.error = 'simplex-chat exited with code ' + code
      that.emit('error', new Error(that.error))
    }
  })
  return Promise.resolve(this)
}

SimplexBridge.prototype._recordError = function(err) {
  this.statusValue = 'error'
  this.error = err.message
  this.emit('error', err)
}

SimplexBridge.prototype._onOutput = function(chunk) {
  var that = this
  this._buffer += stripAnsi(chunk.toString())
  var lines = this._buffer.split(/\r?\n/)
  this._buffer = lines.pop()
  lines.forEach(function(line) {
    var command = parseIncomingLine(line, that.allowedSender)
    if (command) {
      that.emit(command.type, command)
    }
    that.emit('log', line)
  })
}

SimplexBridge.prototype.send = function(message) {
  if (!this.child || !this.child.stdin || !this.contact) {
    return Promise.reject(new Error('SimpleX bridge is not connected'))
  }
  var line = '@' + this.contact + ' ' + String(message).replace(/[\r\n]+/g, ' ')
  this.child.stdin.write(line + '\n')
  return Promise.resolve()
}

SimplexBridge.prototype.notifyMission = function(mission) {
  if (!mission || !this.enabled) {
    return Promise.resolve()
  }
  var message
  if (mission.status === 'queued') {
    message = 'Mission queued: ' + mission.title + ' [' + mission.id + ']'
  }
  else if (mission.status === 'running') {
    message = 'Mission started: ' + mission.title + ' [' + mission.id + ']'
  }
  else if (mission.status === 'completed') {
    message = 'Mission completed: ' + mission.title + ' [' + mission.id + ']'
  }
  else if (mission.status === 'failed') {
    message = 'Mission blocked: ' + mission.title + ' [' + mission.id + '] - ' + mission.error
  }
  else if (mission.status === 'cancelled') {
    message = 'Mission cancelled: ' + mission.title + ' [' + mission.id + ']'
  }
  return message ? this.send(message).catch(function() {}) : Promise.resolve()
}

SimplexBridge.prototype.status = function() {
  return {enabled: this.enabled, status: this.statusValue, contact: this.contact || null,
    error: this.error}
}

SimplexBridge.prototype.close = function() {
  this.statusValue = 'stopped'
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
  parseIncomingLine: parseIncomingLine
}
