var levelInfo = [
  {name: 'debug', label: 'Debug'}
, {name: 'verbose', label: 'Verbose'}
, {name: 'info', label: 'Info'}
, {name: 'important', label: 'Important'}
, {name: 'warning', label: 'Warning'}
, {name: 'error', label: 'Error'}
, {name: 'fatal', label: 'Fatal'}
]

function getLevel(priority) {
  var item = levelInfo[Number(priority) - 1]
  return item || {name: 'unknown', label: 'Unknown'}
}

function splitMessage(message) {
  var text = String(message || '')
  var newline = text.search(/\r?\n/)

  if (newline === -1) {
    return {summary: text, details: ''}
  }

  return {
    summary: text.slice(0, newline)
  , details: text.slice(newline).replace(/^\r?\n/, '')
  }
}

module.exports = {
  level: getLevel
, present: function(entry) {
    var level = getLevel(entry.priority)
    var message = splitMessage(entry.message)

    return Object.assign({}, entry, {
      priority: Number(entry.priority)
    , level: level.name
    , levelLabel: level.label
    , severity: level.name
    , messageSummary: message.summary
    , details: message.details
    })
  }
}
