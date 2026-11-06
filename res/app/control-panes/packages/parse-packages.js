var SEPARATOR = '=====STF-PACKAGES====='

var DETAIL_FIELDS = [
  ['versionCode', /versionCode=(\d+)/, Number]
, ['targetSdk', /targetSdk=(\d+)/, Number]
, ['versionName', /versionName=(.*)/, String]
, ['firstInstallTime', /firstInstallTime=(.*)/, String]
, ['lastUpdateTime', /lastUpdateTime=(.*)/, String]
]

// One shell round trip: paths and uids from pm, everything else from a single
// dumpsys (a dumpsys per package would take ~0.15s each).
function command(includeSystem) {
  return 'pm list packages -f -U' + (includeSystem ? '' : ' -3') +
    '; echo ' + SEPARATOR +
    '; dumpsys package packages | grep -E ' +
    '"^  Package \\[|versionCode=|versionName=|firstInstallTime=|lastUpdateTime="'
}

function parseDetails(text) {
  var details = Object.create(null)
  var current = null

  text.split('\n').forEach(function(line) {
    var header = /^\s*Package \[([^\]]+)\]/.exec(line)
    if (header) {
      // An updated system app is listed again under "Hidden system packages";
      // the first block is the active one.
      current = details[header[1]] ? null : (details[header[1]] = {})
      return
    }
    if (!current) {
      return
    }
    DETAIL_FIELDS.forEach(function(field) {
      var match = field[1].exec(line)
      if (match && typeof current[field[0]] === 'undefined') {
        current[field[0]] = field[2](match[1].trim())
      }
    })
  })
  return details
}

function parse(text) {
  var parts = text.split(SEPARATOR)
  var details = parseDetails(parts[1] || '')

  return parts[0].split('\n')
    .map(function(line) {
      // package:<apk path>=<name> uid:<uid>; the path itself may contain '='
      var match = /^package:(.+)=([^=\s]+)\s+uid:(\d+)/.exec(line.trim())
      if (!match) {
        return null
      }
      return Object.assign({
        path: match[1]
      , name: match[2]
      , uid: match[3]
      }, details[match[2]])
    })
    .filter(Boolean)
}

module.exports = {
  command: command
, parse: parse
}
