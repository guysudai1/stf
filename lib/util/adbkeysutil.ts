// Provider-side ADB private keys, kept in the folder adb reads through
// ADB_VENDOR_KEYS. adb only loads directory entries ending in ".adb_key".
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

var SUFFIX = '.adb_key'
var NAME_RE = /^[\w-][\w.-]{0,63}$/
var MAX_KEY_LENGTH = 16384

export interface AdbKeyEntry {
  name: string
  fingerprint: string | null
  size: number
  modified: string
  loaded: boolean
}

export interface AddedAdbKey {
  name: string
  fingerprint: string
}

interface HttpError extends Error {
  status: number
}

function httpError(status: number, message: string) {
  var err = new Error(message) as HttpError
  err.status = status
  return err
}

function littleEndian(value: bigint, bytes: number) {
  var hex = value.toString(16).padStart(bytes * 2, '0')
  return Buffer.from(hex, 'hex').reverse()
}

// The RSAPublicKey struct adb sends to devices (see adbkit's auth.js).
function androidPublicKey(privateKey: crypto.KeyObject) {
  var jwk = crypto.createPublicKey(privateKey).export({format: 'jwk'})
  var n = BigInt('0x' + Buffer.from(jwk.n ?? '', 'base64url').toString('hex'))
  var e = parseInt(Buffer.from(jwk.e ?? '', 'base64url').toString('hex'), 16)
  var mask = BigInt(0xffffffff)
  var two = BigInt(2)
  var n0 = n & mask
  var inv = n0
  for (var i = 0; i < 5; i += 1) {
    inv = (inv * (two - n0 * inv)) & mask
  }
  var struct = Buffer.alloc(524)
  struct.writeUInt32LE(64, 0)
  struct.writeUInt32LE(Number((mask + BigInt(1) - inv) & mask), 4)
  littleEndian(n, 256).copy(struct, 8)
  littleEndian((BigInt(1) << BigInt(4096)) % n, 256).copy(struct, 264)
  struct.writeUInt32LE(e, 520)
  return struct
}

// Same MD5 format as the per-user ADB keys pane and the device's
// "Allow USB debugging" dialog, so the two can be compared.
function fingerprint(privateKey: crypto.KeyObject) {
  return (crypto.createHash('md5')
    .update(androidPublicKey(privateKey))
    .digest('hex').match(/../g) ?? []).join(':')
}

function parseKey(pem: string | Buffer) {
  var key: crypto.KeyObject
  try {
    key = crypto.createPrivateKey(pem)
  }
  catch {
    throw httpError(400, 'Bad Request: not a readable unencrypted PEM private key')
  }
  var details = key.asymmetricKeyDetails
  if (key.asymmetricKeyType !== 'rsa' || details?.modulusLength !== 2048 ||
      [3, 65537].indexOf(Number(details.publicExponent)) < 0) {
    throw httpError(400, 'Bad Request: adb needs a 2048-bit RSA key')
  }
  return key
}

function fileName(name: string) {
  var file = name.endsWith(SUFFIX) ? name : name + SUFFIX
  if (!NAME_RE.test(file)) {
    throw httpError(400,
      'Bad Request: name may only use letters, digits, ".", "_" and "-" (max 64)')
  }
  return file
}

async function list(dir: string): Promise<AdbKeyEntry[]> {
  var entries = (await fs.promises.readdir(dir, {withFileTypes: true}))
    .filter(function(entry) {
      return entry.isFile() && entry.name[0] !== '.'
    })
  var keys = await Promise.all(entries.map(async function(entry) {
    var file = path.join(dir, entry.name)
    var stats = await fs.promises.stat(file)
    var print: string | null
    try {
      print = stats.size <= MAX_KEY_LENGTH ?
        fingerprint(parseKey(await fs.promises.readFile(file, 'utf8'))) : null
    }
    catch {
      print = null
    }
    return {
      name: entry.name
    , fingerprint: print
    , size: stats.size
    , modified: stats.mtime.toISOString()
    , loaded: entry.name.endsWith(SUFFIX) && print !== null
    }
  }))
  return keys.sort(function(a, b) {
    return a.name.localeCompare(b.name)
  })
}

async function add(dir: string, name: string, pem: string): Promise<AddedAdbKey> {
  var file = fileName(name)
  var print = fingerprint(parseKey(pem))
  try {
    // 'wx' refuses to replace an existing file or follow a planted symlink.
    await fs.promises.writeFile(path.join(dir, file), pem, {mode: 0o600, flag: 'wx'})
  }
  catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'EEXIST' ?
      httpError(409, 'Conflict: a key with this name already exists') : err
  }
  return {name: file, fingerprint: print}
}

async function remove(dir: string, name: string): Promise<void> {
  if (!NAME_RE.test(name)) {
    throw httpError(400, 'Bad Request: invalid key name')
  }
  try {
    await fs.promises.unlink(path.join(dir, name))
  }
  catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'ENOENT' ?
      httpError(404, 'Not Found (key)') : err
  }
}

export default {androidPublicKey, fingerprint, parseKey, fileName, list, add, remove}
