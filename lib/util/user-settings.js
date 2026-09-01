var MAX_DEVICE_TIMEOUT = 24 * 60 * 60 * 1000

function invalidDeviceTimeout(message) {
  return {
    valid: false
  , value: null
  , error: message
  }
}

function validateDeviceTimeout(value) {
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

  if (value > MAX_DEVICE_TIMEOUT) {
    return invalidDeviceTimeout('deviceTimeout must not exceed 24 hours (86400000 milliseconds)')
  }

  return {
    valid: true
  , value: value
  }
}

function normalizeChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new TypeError('User settings changes must be an object')
  }

  var normalized = Object.assign({}, changes)
  if (Object.prototype.hasOwnProperty.call(normalized, 'deviceTimeout')) {
    var result = validateDeviceTimeout(normalized.deviceTimeout)
    if (!result.valid) {
      throw new RangeError(result.error)
    }
    normalized.deviceTimeout = result.value
  }

  return normalized
}

function resolveDeviceTimeout(settings) {
  var result = validateDeviceTimeout(settings && settings.deviceTimeout)
  return result.valid ? result.value : null
}

function resolveTimeout(requestedTimeout, settings) {
  return requestedTimeout || resolveDeviceTimeout(settings)
}

module.exports = {
  MAX_DEVICE_TIMEOUT: MAX_DEVICE_TIMEOUT
, validateDeviceTimeout: validateDeviceTimeout
, normalizeChanges: normalizeChanges
, resolveDeviceTimeout: resolveDeviceTimeout
, resolveTimeout: resolveTimeout
}
