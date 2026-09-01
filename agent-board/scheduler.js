var EventEmitter = require('events')
var createDemoWorker = require('./adapters').createDemoWorker

function asWorkerCount(value) {
  var workers = Number(value)
  if (!Number.isInteger(workers) || workers < 1) {
    throw new TypeError('Worker count must be a positive integer')
  }
  return workers
}

function MissionScheduler(options) {
  EventEmitter.call(this)
  options = options || {}
  if (!options.store) {
    throw new TypeError('Scheduler requires a mission store')
  }
  this.store = options.store
  var configuredWorkers = options.workers !== undefined ? options.workers : options.workerCount
  this.workerCount = asWorkerCount(configuredWorkers === undefined ? 1 : configuredWorkers)
  this.pollInterval = Number.isFinite(options.pollInterval) ? options.pollInterval : 1000
  this.workerPrefix = options.workerPrefix || 'worker'
  this.adapters = Object.assign({demo: createDemoWorker()}, options.adapters || {})
  this._active = new Map()
  this._workerSequence = 0
  this._timer = null
  this._started = false
  this._pumping = false
  this._onStoreChange = this._onStoreChange.bind(this)
}

MissionScheduler.prototype = Object.create(EventEmitter.prototype)
MissionScheduler.prototype.constructor = MissionScheduler

MissionScheduler.prototype.start = function() {
  var that = this
  if (this._started) {
    return Promise.resolve(this)
  }
  this._started = true
  this.store.on('change', this._onStoreChange)
  return this.store.ready.then(function() {
    that._pump()
    if (that.pollInterval > 0) {
      that._timer = setInterval(function() {
        that._pump()
      }, that.pollInterval)
    }
    return that
  })
}

MissionScheduler.prototype.stop = function() {
  var that = this
  this._started = false
  this.store.removeListener('change', this._onStoreChange)
  if (this._timer) {
    clearInterval(this._timer)
    this._timer = null
  }
  return Promise.all(Array.from(this._active.values())).then(function() {
    return that
  })
}

MissionScheduler.prototype._onStoreChange = function(change) {
  if (this._started && change && change.mission && change.mission.status === 'queued') {
    this._pump()
  }
}

MissionScheduler.prototype._nextMission = function() {
  return this.store.list({status: 'queued'}).then(function(missions) {
    missions.sort(function(left, right) {
      return right.priority - left.priority || left.createdAt.localeCompare(right.createdAt)
    })
    return missions[0]
  })
}

MissionScheduler.prototype._pump = function() {
  var that = this
  if (!this._started || this._pumping) {
    return
  }
  this._pumping = true
  var loop = function() {
    if (!that._started || that._active.size >= that.workerCount) {
      that._pumping = false
      return Promise.resolve()
    }
    return that._nextMission().then(function(mission) {
      if (!mission) {
        that._pumping = false
        return null
      }
      var workerId = that.workerPrefix + '-' + (++that._workerSequence)
      return that.store.claim(mission.id, workerId).then(function(claimed) {
        if (!claimed) {
          return loop()
        }
        var task = that._run(claimed, workerId)
        that._active.set(claimed.id, task)
        return loop()
      })
    })
  }
  loop().catch(function(err) {
    that._pumping = false
    if (that.listenerCount('error') > 0) {
      that.emit('error', err)
    }
  })
}

MissionScheduler.prototype._run = function(mission, workerId) {
  var that = this
  var controller = new AbortController()
  var adapter = this.adapters[mission.adapter || 'demo']
  var context = {workerId: workerId, signal: controller.signal, scheduler: this}
  var operation

  if (typeof adapter !== 'function') {
    operation = Promise.reject(new Error('Unknown mission adapter: ' + mission.adapter))
  }
  else {
    try {
      operation = Promise.resolve(adapter(mission, context))
    }
    catch (err) {
      operation = Promise.reject(err)
    }
  }

  var task = operation.then(function(result) {
    return that.store.transition(mission.id, 'completed', {
      result: result,
      finishedAt: new Date().toISOString()
    }, {expectedStatus: 'running'}).then(function(updated) {
      if (updated) {
        that.emit('completed', updated)
      }
      return updated
    })
  }).catch(function(err) {
    var error = err && err.message ? err.message : String(err)
    return that.store.transition(mission.id, 'failed', {
      error: error,
      result: err && err.result,
      finishedAt: new Date().toISOString()
    }, {expectedStatus: 'running'}).then(function(updated) {
      if (updated) {
        that.emit('failed', updated)
      }
      return updated
    })
  }).finally(function() {
    that._active.delete(mission.id)
    that._pump()
  })
  task.controller = controller
  return task
}

MissionScheduler.prototype.cancel = function(id) {
  var active = this._active.get(id)
  if (active && active.controller) {
    active.controller.abort()
  }
  return this.store.cancel(id).then(function(mission) {
    return mission
  })
}

MissionScheduler.prototype.retry = function(id) {
  return this.store.get(id).then(function(mission) {
    if (!mission) {
      return null
    }
    if (mission.status !== 'failed' && mission.status !== 'cancelled') {
      throw new Error('Only failed or cancelled missions can be retried')
    }
    return this.store.transition(id, 'queued', {
      error: undefined,
      result: undefined,
      workerId: undefined,
      startedAt: undefined,
      finishedAt: undefined
    })
  }).then(function(mission) {
    return mission
  })
}

module.exports = {
  MissionScheduler: MissionScheduler,
  asWorkerCount: asWorkerCount
}
