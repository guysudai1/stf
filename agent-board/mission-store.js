var fs = require('fs')
var path = require('path')
var crypto = require('crypto')
var EventEmitter = require('events')

var fsp = fs.promises

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function now() {
  return new Date().toISOString()
}

function makeId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return crypto.randomBytes(16).toString('hex')
}

function assertMissionId(id) {
  if (!id || typeof id !== 'string') {
    throw new TypeError('Mission id must be a non-empty string')
  }
}

function normalizeRecord(record) {
  var mission = Object.assign({}, record)
  mission.status = mission.status || 'queued'
  mission.attempts = Number.isInteger(mission.attempts) ? mission.attempts : 0
  return mission
}

function JsonMissionStore(options) {
  EventEmitter.call(this)
  options = options || {}
  this.filePath = options.filePath || path.join(process.cwd(), 'missions.json')
  this.idFactory = options.idFactory || makeId
  this.clock = options.clock || now
  this._missions = []
  this._writeQueue = Promise.resolve()
  this.ready = this._load()
}

JsonMissionStore.prototype = Object.create(EventEmitter.prototype)
JsonMissionStore.prototype.constructor = JsonMissionStore

JsonMissionStore.prototype._load = function() {
  var that = this
  return fsp.readFile(this.filePath, 'utf8')
    .then(function(contents) {
      var parsed = JSON.parse(contents)
      var records = Array.isArray(parsed) ? parsed : parsed.missions
      if (!Array.isArray(records)) {
        throw new Error('Mission store must contain a missions array')
      }
      that._missions = records.map(normalizeRecord)
    })
    .catch(function(err) {
      if (err.code === 'ENOENT') {
        that._missions = []
        return that._persist()
      }
      throw err
    })
}

JsonMissionStore.prototype._persist = function() {
  var that = this
  var directory = path.dirname(this.filePath)
  var temporaryPath = this.filePath + '.tmp'
  this._writeQueue = this._writeQueue
    .then(function() {
      return fsp.mkdir(directory, {recursive: true})
    })
    .then(function() {
      var contents = JSON.stringify({version: 1, missions: that._missions}, null, 2) + '\n'
      return fsp.writeFile(temporaryPath, contents, 'utf8')
    })
    .then(function() {
      return fsp.rename(temporaryPath, that.filePath)
    })
  return this._writeQueue
}

JsonMissionStore.prototype._find = function(id) {
  return this._missions.find(function(mission) {
    return mission.id === id
  })
}

JsonMissionStore.prototype.list = function(options) {
  var that = this
  options = options || {}
  return this.ready.then(function() {
    var missions = that._missions
    if (options.status) {
      missions = missions.filter(function(mission) {
        return mission.status === options.status
      })
    }
    return clone(missions)
  })
}

JsonMissionStore.prototype.get = function(id) {
  var that = this
  assertMissionId(id)
  return this.ready.then(function() {
    var mission = that._find(id)
    return mission ? clone(mission) : null
  })
}

JsonMissionStore.prototype.create = function(input) {
  var that = this
  input = input || {}
  if (typeof input.prompt !== 'string' && typeof input.command !== 'string') {
    return Promise.reject(new TypeError('Mission requires a prompt or command'))
  }
  if (input.adapter !== undefined && typeof input.adapter !== 'string') {
    return Promise.reject(new TypeError('Mission adapter must be a string'))
  }

  return this.ready.then(function() {
    var timestamp = that.clock()
    var mission = {
      id: input.id || that.idFactory(),
      title: input.title || input.name || input.prompt || input.command,
      prompt: input.prompt,
      command: input.command,
      args: Array.isArray(input.args) ? input.args.slice() : undefined,
      adapter: input.adapter || (input.command ? 'command' : 'demo'),
      priority: Number.isFinite(input.priority) ? input.priority : 0,
      metadata: input.metadata || {},
      status: 'queued',
      attempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    Object.keys(mission).forEach(function(key) {
      if (mission[key] === undefined) {
        delete mission[key]
      }
    })
    that._missions.push(mission)
    return that._persist().then(function() {
      that.emit('change', {type: 'created', mission: clone(mission)})
      return clone(mission)
    })
  })
}

JsonMissionStore.prototype.update = function(id, patch, options) {
  var that = this
  assertMissionId(id)
  patch = patch || {}
  options = options || {}
  return this.ready.then(function() {
    var mission = that._find(id)
    if (!mission) {
      return null
    }
    if (options.expectedStatus && (Array.isArray(options.expectedStatus) ?
      options.expectedStatus.indexOf(mission.status) === -1 :
      mission.status !== options.expectedStatus)) {
      return null
    }
    Object.keys(patch).forEach(function(key) {
      if (patch[key] === undefined) {
        delete mission[key]
      }
      else {
        mission[key] = patch[key]
      }
    })
    mission.updatedAt = that.clock()
    return that._persist().then(function() {
      that.emit('change', {type: 'updated', mission: clone(mission)})
      return clone(mission)
    })
  })
}

JsonMissionStore.prototype.transition = function(id, status, patch, options) {
  patch = Object.assign({}, patch || {}, {status: status})
  return this.update(id, patch, options)
}

JsonMissionStore.prototype.claim = function(id, workerId) {
  var that = this
  return this.get(id).then(function(mission) {
    if (!mission || mission.status !== 'queued') {
      return null
    }
    return that.transition(id, 'running', {
      workerId: workerId,
      startedAt: that.clock(),
      finishedAt: undefined,
      error: undefined,
      result: undefined,
      attempts: mission.attempts + 1
    }, {expectedStatus: 'queued'})
  })
}

JsonMissionStore.prototype.cancel = function(id, reason) {
  var that = this
  return this.transition(id, 'cancelled', {
    error: reason || 'Cancelled by user',
    finishedAt: that.clock()
  }, {expectedStatus: ['queued', 'running']})
}

JsonMissionStore.prototype.remove = function(id) {
  var that = this
  assertMissionId(id)
  return this.ready.then(function() {
    var index = that._missions.findIndex(function(mission) {
      return mission.id === id
    })
    if (index === -1) {
      return false
    }
    var mission = that._missions[index]
    that._missions.splice(index, 1)
    return that._persist().then(function() {
      that.emit('change', {type: 'removed', mission: clone(mission)})
      return true
    })
  })
}

module.exports = {
  JsonMissionStore: JsonMissionStore,
  MissionStore: JsonMissionStore,
  makeId: makeId
}
