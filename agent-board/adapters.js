var childProcess = require('child_process')

function createDemoWorker(options) {
  options = options || {}
  var delay = Number.isFinite(options.delay) ? options.delay : 0
  return function(mission, context) {
    return new Promise(function(resolve, reject) {
      var timer = setTimeout(function() {
        resolve({
          message: options.message || 'Demo mission completed',
          missionId: mission.id,
          workerId: context && context.workerId
        })
      }, delay)
      if (context && context.signal) {
        context.signal.addEventListener('abort', function() {
          clearTimeout(timer)
          reject(new Error('Mission aborted'))
        }, {once: true})
      }
    })
  }
}

function commandArguments(mission, options) {
  if (typeof options.args === 'function') {
    return options.args(mission)
  }
  if (Array.isArray(options.args)) {
    return options.args.slice()
  }
  return Array.isArray(mission.args) ? mission.args.slice() : []
}

function createCommandAdapter(options) {
  options = options || {}
  return function(mission, context) {
    var command = options.command || mission.command
    if (typeof command !== 'string' || command.length === 0) {
      return Promise.reject(new TypeError('Command adapter requires a command'))
    }
    var args = commandArguments(mission, options)
    var spawnOptions = {
      cwd: options.cwd,
      env: Object.assign({}, process.env, options.env || {}),
      shell: false
    }
    return new Promise(function(resolve, reject) {
      var child = childProcess.spawn(command, args, spawnOptions)
      var stdout = ''
      var stderr = ''
      var settled = false
      var timeout

      function finish(callback, value) {
        if (settled) {
          return
        }
        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }
        callback(value)
      }

      child.stdout.on('data', function(chunk) {
        stdout += chunk.toString()
      })
      child.stderr.on('data', function(chunk) {
        stderr += chunk.toString()
      })
      child.on('error', function(err) {
        finish(reject, err)
      })
      child.on('close', function(code, signal) {
        var result = {command: command, args: args, stdout: stdout, stderr: stderr,
          code: code, signal: signal}
        if (code === 0) {
          finish(resolve, result)
        }
        else {
          var error = new Error(stderr.trim() || 'Command exited with code ' + code)
          error.result = result
          finish(reject, error)
        }
      })

      if (context && context.signal) {
        context.signal.addEventListener('abort', function() {
          child.kill('SIGTERM')
          finish(reject, new Error('Mission aborted'))
        }, {once: true})
      }
      if (Number.isFinite(options.timeout) && options.timeout > 0) {
        timeout = setTimeout(function() {
          child.kill('SIGTERM')
          finish(reject, new Error('Command timed out after ' + options.timeout + 'ms'))
        }, options.timeout)
      }
    })
  }
}

function createCodexAdapter(options) {
  options = Object.assign({command: 'codex'}, options || {})
  var command = options.command
  var extraArgs = options.extraArgs || []
  options.args = function(mission) {
    var prompt = mission.prompt || mission.title
    return ['exec'].concat(extraArgs, [prompt])
  }
  return createCommandAdapter(options)
}

module.exports = {
  createDemoWorker: createDemoWorker,
  createCommandAdapter: createCommandAdapter,
  createCodexAdapter: createCodexAdapter
}
