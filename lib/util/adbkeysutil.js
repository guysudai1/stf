// Provider-side ADB private keys, kept in the folder adb reads through
// ADB_VENDOR_KEYS. adb only loads directory entries ending in ".adb_key".
var crypto = require('crypto')
var Promise = require('bluebird')
var fs = require('fs')
var path = require('path')

// The lint config predates BigInt.
var bigint = global.BigInt

var SUFFIX = '.adb_key'
var NAME_RE = /^[\w-][\w.-]{0,63}$/
var MAX_KEY_LENGTH = 16384

var adbkeysutil = module.exports = Object.create(null)

function httpError(status, message) {
  var err = new Error(message)
  err.status = status
  return err
}

function littleEndian(value, bytes) {
  var hex = value.toString(16).padStart(bytes * 2, '0')
  return Buffer.from(hex, 'hex').reverse()
}

// The RSAPublicKey struct adb sends to devices (see adbkit's auth.js).
adbkeysutil.androidPublicKey = function(privateKey) {
  var jwk = crypto.createPublicKey(privateKey).export({format: 'jwk'})
  var n = bigint('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'))
  var e = parseInt(Buffer.from(jwk.e, 'base64url').toString('hex'), 16)
  var mask = bigint(0xffffffff)
  var two = bigint(2)
  var n0 = n & mask
  var inv = n0
  for (var i = 0; i < 5; i += 1) {
    inv = (inv * (two - n0 * inv)) & mask
  }
  var struct = Buffer.alloc(524)
  struct.writeUInt32LE(64, 0)
  struct.writeUInt32LE(Number((mask + bigint(1) - inv) & mask), 4)
  littleEndian(n, 256).copy(struct, 8)
  littleEndian((bigint(1) << bigint(4096)) % n, 256).copy(struct, 264)
  struct.writeUInt32LE(e, 520)
  return struct
}

// Same MD5 format as the per-user ADB keys pane and the device's
// "Allow USB debugging" dialog, so the two can be compared.
adbkeysutil.fingerprint = function(privateKey) {
  return crypto.createHash('md5')
    .update(adbkeysutil.androidPublicKey(privateKey))
    .digest('hex').match(/../g).join(':')
}

adbkeysutil.parseKey = function(pem) {
  var key
  try {
    key = crypto.createPrivateKey(pem)
  }
  catch (err) {
    throw httpError(400, 'Bad Request: not a readable unencrypted PEM private key')
  }
  var details = key.asymmetricKeyDetails
  if (key.asymmetricKeyType !== 'rsa' || details.modulusLength !== 2048 ||
      [3, 65537].indexOf(Number(details.publicExponent)) < 0) {
    throw httpError(400, 'Bad Request: adb needs a 2048-bit RSA key')
  }
  return key
}

adbkeysutil.fileName = function(name) {
  var file = name.endsWith(SUFFIX) ? name : name + SUFFIX
  if (!NAME_RE.test(file)) {
    throw httpError(400,
      'Bad Request: name may only use letters, digits, ".", "_" and "-" (max 64)')
  }
  return file
}

adbkeysutil.list = function(dir) {
  return Promise.resolve(fs.promises.readdir(dir, {withFileTypes: true}))
    .filter(function(entry) {
      return entry.isFile() && entry.name[0] !== '.'
    })
    .map(function(entry) {
      var file = path.join(dir, entry.name)
      return fs.promises.stat(file).then(function(stats) {
        return Promise.try(function() {
          return stats.size <= MAX_KEY_LENGTH ? fs.promises.readFile(file, 'utf8') : null
        })
          .then(function(pem) {
            return adbkeysutil.fingerprint(adbkeysutil.parseKey(pem))
          })
          .catch(function() {
            return null
          })
          .then(function(fingerprint) {
            return {
              name: entry.name
            , fingerprint: fingerprint
            , size: stats.size
            , modified: stats.mtime.toISOString()
            , loaded: entry.name.endsWith(SUFFIX) && fingerprint !== null
            }
          })
      })
    })
    .then(function(keys) {
      return keys.sort(function(a, b) {
        return a.name.localeCompare(b.name)
      })
    })
}

adbkeysutil.add = function(dir, name, pem) {
  return Promise.try(function() {
    var file = adbkeysutil.fileName(name)
    var fingerprint = adbkeysutil.fingerprint(adbkeysutil.parseKey(pem))
    // 'wx' refuses to replace an existing file or follow a planted symlink.
    return fs.promises.writeFile(path.join(dir, file), pem, {mode: 0o600, flag: 'wx'})
      .then(function() {
        return {name: file, fingerprint: fingerprint}
      }, function(err) {
        throw err.code === 'EEXIST' ?
          httpError(409, 'Conflict: a key with this name already exists') : err
      })
  })
}

adbkeysutil.remove = function(dir, name) {
  return Promise.try(function() {
    if (!NAME_RE.test(name)) {
      throw httpError(400, 'Bad Request: invalid key name')
    }
    return fs.promises.unlink(path.join(dir, name))
  })
    .catch(function(err) {
      throw err.code === 'ENOENT' ? httpError(404, 'Not Found (key)') : err
    })
}
