var MAX_DEVICE_TIMEOUT = 24 * 60 * 60 * 1000

interface TimeoutValidation {
  valid: boolean
  value: number | null
  error?: string
}

interface UserSettingsUtil {
  MAX_DEVICE_TIMEOUT: number
  validateDeviceTimeout(value: unknown): TimeoutValidation
  normalizeChanges(changes: unknown): Record<string, unknown>
  resolveTimeout(
    requestedTimeout: number | null | undefined
  , settings: object | null | undefined
  ): number | null
}

var usersettings: UserSettingsUtil = Object.create(null)

usersettings.MAX_DEVICE_TIMEOUT = MAX_DEVICE_TIMEOUT

function invalidDeviceTimeout(message: string): TimeoutValidation {
  return {
    valid: false
  , value: null
  , error: message
  }
}

usersettings.validateDeviceTimeout = function(value) {
  if (value === null || typeof value === 'undefined') {
    return {
      valid: true
    , value: null
    }
  }

  if (typeof value !== 'number' || !isFinite(value)) {
    return invalidDeviceTimeout('deviceTimeout must be a finite number of milliseconds')
  }

  if (value <= 0) {
    return {
      valid: true
    , value: null
    }
  }

  if (Math.floor(value) !== value) {
    return invalidDeviceTimeout('deviceTimeout must be an integer number of milliseconds')
  }

  if (value > MAX_DEVICE_TIMEOUT) {
    return invalidDeviceTimeout('deviceTimeout must not exceed 24 hours (86400000 milliseconds)')
  }

  return {
    valid: true
  , value: value
  }
}

usersettings.normalizeChanges = function(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('User settings changes must be an object')
  }

  var normalized = Object.assign({}, changes) as Record<string, unknown>
  if (Object.prototype.hasOwnProperty.call(normalized, 'deviceTimeout')) {
    var result = usersettings.validateDeviceTimeout(normalized.deviceTimeout)
    if (!result.valid) {
      throw new RangeError(result.error)
    }
    normalized.deviceTimeout = result.value
  }

  return normalized
}

usersettings.resolveTimeout = function(requestedTimeout, settings) {
  if (requestedTimeout) {
    return requestedTimeout
  }
  var result = usersettings.validateDeviceTimeout(
    settings && (settings as Record<string, unknown>).deviceTimeout
  )
  return result.valid ? result.value : null
}

export default usersettings
