var logger = require('./logger')

var levelNames = Object.keys(logger.Level).reduce(function(names, name) {
  names[logger.Level[name]] = name.toLowerCase()
  return names
}, {})

module.exports.present = function(entry) {
  var priority = Number(entry.priority)
  var severity = levelNames[priority] || 'unknown'
  var lines = String(entry.message || '').split(/\r?\n/)

  return Object.assign({}, entry, {
    priority: priority
  , severity: severity
  , levelLabel: severity.charAt(0).toUpperCase() + severity.slice(1)
  , messageSummary: lines[0]
  , details: lines.slice(1).join('\n')
  })
}
