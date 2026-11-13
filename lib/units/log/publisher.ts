import logger from '../../util/logger.js'
import healthlog from '../../util/healthlog.js'
import wire from '../../wire/index.js'
import wireutil from '../../wire/util.js'
import type {ZmqSocket} from '../../types/device-plugins.js'

interface HealthEntry {
  timestamp: Date | number
  priority: number
  tag: string
  pid: number
  message: string
  identifier: string
}

interface PublisherOptions {
  serial?: string
  kind?: string
}

type Pushable = Pick<ZmqSocket, 'send'>

function send(push: Pushable, entry: HealthEntry, options?: PublisherOptions) {
  var millis = entry.timestamp instanceof Date ? entry.timestamp.getTime() : Number(entry.timestamp)
  var message = new wire.HealthLogMessage(
    millis / 1000
  , healthlog.classify(entry)
  , entry.tag
  , entry.pid
  , entry.message
  , entry.identifier
  , options?.serial
  , options?.kind || 'server'
  )

  push.send([
    wireutil.global
  , wireutil.envelope(message)
  ])
}

function publish(push: Pushable, options?: PublisherOptions) {
  function listener(entry: HealthEntry) {
    if (healthlog.shouldPublish(entry)) {
      send(push, entry, options)
    }
  }

  logger.on('entry', listener)
  return function() {
    logger.removeListener('entry', listener)
  }
}

export default Object.assign(publish, {send})
