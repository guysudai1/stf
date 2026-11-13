import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as chai from 'chai'
var expect = chai.expect

import adbutil from '../../lib/util/adbutil.js'
import adbkeysutil from '../../lib/util/adbkeysutil.js'

var adb = adbutil()

function pem(bits: number) {
  return crypto.generateKeyPairSync('rsa', {modulusLength: bits}).privateKey
    .export({type: 'pkcs8', format: 'pem'}) as string
}

function status(fn: () => unknown) {
  try {
    fn()
  }
  catch (err) {
    return (err as {status?: number}).status
  }
  return 'no error'
}

describe('adbkeysutil', function() {
  var key = pem(2048)
  var dir: string

  beforeEach(function() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adbkeys-'))
  })

  afterEach(function() {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('fingerprints like the per-user ADB keys pane', function() {
    var pub = adbkeysutil.androidPublicKey(crypto.createPrivateKey(key)).toString('base64') + ' x@y'
    return adb.util.parsePublicKey(pub).then(function(parsed) {
      expect(adbkeysutil.fingerprint(crypto.createPrivateKey(key))).to.equal(parsed.fingerprint)
    })
  })

  it('rejects unsafe names and unusable keys', function() {
    ['../evil', '.hidden', 'a/b', '', 'x'.repeat(65)].forEach(function(name) {
      expect(status(function() {
        adbkeysutil.fileName(name)
      }), String(name)).to.equal(400)
    })
    expect(adbkeysutil.fileName('laptop')).to.equal('laptop.adb_key')
    var publicPem = crypto.createPublicKey(key).export({type: 'spki', format: 'pem'}) as string
    ;['garbage', pem(1024), publicPem, null as unknown as string].forEach(function(bad) {
      expect(status(function() {
        adbkeysutil.parseKey(bad)
      })).to.equal(400)
    })
  })

  it('adds without overwriting, lists without contents, removes', async function() {
    var added = await adbkeysutil.add(dir, 'laptop', key)
    expect(added.name).to.equal('laptop.adb_key')
    expect(fs.statSync(path.join(dir, added.name)).mode & 0o777).to.equal(0o600)
    await adbkeysutil.add(dir, 'laptop', key).then(function() {
      throw new Error('overwrote')
    }, function(err) {
      expect(err.status).to.equal(409)
    })

    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi')
    var keys = await adbkeysutil.list(dir)
    expect(keys.map(function(k) {
      return [k.name, k.loaded]
    })).to.deep.equal([['laptop.adb_key', true], ['notes.txt', false]])
    expect(JSON.stringify(keys)).to.not.contain('PRIVATE')

    await adbkeysutil.remove(dir, 'laptop.adb_key')
    await adbkeysutil.remove(dir, '../laptop.adb_key').then(function() {
      throw new Error('removed outside the folder')
    }, function(err) {
      expect(err.status).to.equal(400)
    })
    expect(fs.readdirSync(dir)).to.deep.equal(['notes.txt'])
  })
})
