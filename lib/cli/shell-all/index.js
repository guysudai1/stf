/* global fetch */

module.exports.command = 'shell-all <command..>'

module.exports.describe = 'Run an adb shell command on every device (admin).'

module.exports.builder = function(yargs) {
  return yargs
    .env('STF_SHELL_ALL')
    .strict()
    .option('url', {
      alias: 'u'
    , describe: 'Base URL of the STF server.'
    , type: 'string'
    , default: 'http://127.0.0.1:7100'
    })
    .option('token', {
      alias: 't'
    , describe: 'Access token of an administrator (Settings > Keys).'
    , type: 'string'
    , demand: true
    })
    .option('force', {
      alias: 'f'
    , describe: 'Also run on devices that are currently in use.'
    , type: 'boolean'
    , default: false
    })
    .option('timeout', {
      describe: 'Milliseconds before the command is killed on each device.'
    , type: 'number'
    , default: 10000
    })
}

module.exports.handler = function(argv) {
  return fetch(argv.url.replace(/\/$/, '') + '/api/v1/devices/shell', {
    method: 'POST'
  , headers: {
      Authorization: 'Bearer ' + argv.token
    , 'Content-Type': 'application/json'
    }
  , body: JSON.stringify({
      command: argv.command.join(' ')
    , force: argv.force
    , timeout: argv.timeout
    })
  })
    .then(function(res) {
      return res.json().then(function(body) {
        if (!res.ok) {
          throw new Error(res.status + ': ' + (body.description || body.message))
        }
        return body
      })
    })
    .then(function(body) {
      var failed = 0
      body.results.forEach(function(result) {
        var status = 'ok'
        if (result.success === null) {
          status = 'timed out'
        }
        else if (!result.success) {
          status = 'failed'
        }
        if (status !== 'ok') {
          failed += 1
        }
        process.stdout.write('== ' + result.serial + ' [' + status + ']\n')
        process.stdout.write(result.data || result.error || '')
        if (result.data && !/\n$/.test(result.data)) {
          process.stdout.write('\n')
        }
      })
      body.skipped.forEach(function(skip) {
        process.stdout.write('== ' + skip.serial + ' [skipped: ' + skip.reason + ']\n')
      })
      process.stderr.write(body.description + ': ' + body.results.length +
        ' ran, ' + failed + ' failed, ' + body.skipped.length + ' skipped\n')
      process.exit(failed ? 1 : 0)
    })
    .catch(function(err) {
      process.stderr.write('shell-all failed: ' + err.message + '\n')
      process.exit(1)
    })
}
