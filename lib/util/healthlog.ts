import logger from './logger.js'

var levelNames: Record<number, string> = Object.keys(logger.Level).reduce(
  function(names: Record<number, string>, name) {
    names[logger.Level[name as keyof typeof logger.Level]] = name.toLowerCase()
    return names
  }
, {}
)

export interface PresentedEntry {
  priority: number
  severity: string
  levelLabel: string
  messageSummary: string
  details: string
}

interface Rule {
  tag: string
  prefix: string
  level: number
}

function rule(level: number, tag: string, prefix = ''): Rule {
  return {tag: tag, prefix: prefix, level: level}
}

var INFO = logger.Level.INFO
var WARNING = logger.Level.WARNING

// Routine events that are logged at IMPORTANT. The first matching rule wins.
var reclassified: Rule[] = [
  rule(INFO, 'device:plugins:group', 'Now owned by')
, rule(INFO, 'device:plugins:group', 'No longer owned by')
, rule(INFO, 'device:plugins:connect', 'Remote Connect ')
, rule(INFO, 'device:plugins:reboot', 'Rebooting')
, rule(INFO, 'device:plugins:service', 'Service relaunched')
, rule(INFO, 'device:plugins:service', 'Agent relaunched')
, rule(INFO, 'device:plugins:install', 'Tried to install')
, rule(INFO, 'processor', 'Restoring device')
, rule(INFO, 'device:lifecycle:present')
, rule(INFO, 'device:lifecycle:absent')
, rule(INFO, 'device:lifecycle:ready')
, rule(INFO, 'device:connection:found')
, rule(INFO, 'device:connection:registered')
, rule(INFO, 'device:connection:remote-connected')
, rule(WARNING, 'device:connection:status', 'Connection status changed to UNAUTHORIZED')
, rule(WARNING, 'device:connection:status', 'Connection status changed to OFFLINE')
, rule(INFO, 'device:connection:status', 'Connection status changed to ')
]

// Console warnings that already have a structured, per-device health entry
var duplicates: {tag: string, prefix: string}[] = [
  {tag: 'provider', prefix: 'Remote ADB connect failed for '}
]

export default {
  shouldPublish: function(entry: {priority: number, tag: string, message?: string | null}) {
    var message = String(entry.message || '')
    return entry.priority >= logger.Level.IMPORTANT && !duplicates.some(function(duplicate) {
      return duplicate.tag === entry.tag && message.startsWith(duplicate.prefix)
    })
  }
, classify: function(
    entry: {priority: number, tag: string, message?: string | null}
  ): number {
    if (entry.priority !== logger.Level.IMPORTANT) {
      return entry.priority
    }
    var message = String(entry.message || '')
    var match = reclassified.find(function(candidate) {
      return candidate.tag === entry.tag && message.startsWith(candidate.prefix)
    })
    return match ? match.level : entry.priority
  }
, present: function<T extends {priority: number | string, message?: string | null}>(
    entry: T
  ): Omit<T, 'priority'> & PresentedEntry {
    var priority = Number(entry.priority)
    var severity = levelNames[priority] || 'unknown'
    var lines = String(entry.message || '').split(/\r?\n/)

    return Object.assign({}, entry, {
      priority: priority
    , severity: severity
    , levelLabel: severity.charAt(0).toUpperCase() + severity.slice(1)
    , messageSummary: lines[0] as string
    , details: lines.slice(1).join('\n')
    })
  }
}
