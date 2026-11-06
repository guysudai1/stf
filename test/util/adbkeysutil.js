var crypto = require('crypto')
var fs = require('fs')
var os = require('os')
var path = require('path')
var expect = require('chai').expect

var adbkit = require('@devicefarmer/adbkit')
var adbkeysutil = require('../../lib/util/adbkeysutil')

function pem(bits) {
  return crypto.generateKeyPairSync('rsa', {modulusLength: bits}).privateKey
    .export({type: 'pkcs8', format: 'pem'})
}

function status(fn) {
  try {
    fn()
  }
  catch (err) {
    return err.status
  }
  return 'no error'
}

describe('adbkeysutil', function() {
  var key = pem(2048)
  var dir

  beforeEach(function() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adbkeys-'))
  })

  afterEach(function() {
    fs.rmSync(dir, {recursive: true, force: true})
  })

  it('fingerprints like the per-user ADB keys pane', function() {
    var pub = adbkeysutil.androidPublicKey(crypto.createPrivateKey(key)).toString('base64') + ' x@y'
    return adbkit.Adb.util.parsePublicKey(pub).then(function(parsed) {
      expect(adbkeysutil.fingerprint(crypto.createPrivateKey(key))).to.equal(parsed.fingerprint)
    })
  })

  it('rejects unsafe names and unusable keys', function() {
    ['../evil', '.hidden', 'a/b', '', 'x'.repeat(65), 42].forEach(function(name) {
      expect(status(function() {
        adbkeysutil.fileName(name)
      }), String(name)).to.equal(400)
    })
    expect(adbkeysutil.fileName('laptop')).to.equal('laptop.adb_key')
    var publicPem = crypto.createPublicKey(key).export({type: 'spki', format: 'pem'})
    ;['garbage', pem(1024), publicPem, null].forEach(function(bad) {
      expect(status(function() {
        adbkeysutil.parseKey(bad)
      })).to.equal(400)
    })
  })

  it('adds without overwriting, lists without contents, removes', function() {
    return adbkeysutil.add(dir, 'laptop', key)
      .then(function(added) {
        expect(added.name).to.equal('laptop.adb_key')
        expect(fs.statSync(path.join(dir, added.name)).mode & 0o777).to.equal(0o600)
        return adbkeysutil.add(dir, 'laptop', key).then(function() {
          throw new Error('overwrote')
        }, function(err) {
          expect(err.status).to.equal(409)
        })
      })
      .then(function() {
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi')
        return adbkeysutil.list(dir)
      })
      .then(function(keys) {
        expect(keys.map(function(k) {
          return [k.name, k.loaded]
        })).to.deep.equal([['laptop.adb_key', true], ['notes.txt', false]])
        expect(JSON.stringify(keys)).to.not.contain('PRIVATE')
        return adbkeysutil.remove(dir, 'laptop.adb_key')
      })
      .then(function() {
        return adbkeysutil.remove(dir, '../laptop.adb_key').then(function() {
          throw new Error('removed outside the folder')
        }, function(err) {
          expect(err.status).to.equal(400)
        })
      })
      .then(function() {
        expect(fs.readdirSync(dir)).to.deep.equal(['notes.txt'])
      })
  })
})
