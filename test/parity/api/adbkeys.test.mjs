import {test, after} from 'node:test'
import assert from 'node:assert/strict'
import crypto, {generateKeyPairSync} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {OLD_REPO, TARGET, raw, withUsers, uniq} from '../harness.mjs'

const OLD_DIR = path.join(OLD_REPO, 'adbkeys')
const mine = new Set()

after(async () => {
  await withUsers(1, async a => {
    for (const name of mine) await a.api('DELETE', `/adbkeys/${encodeURIComponent(name)}`)
  })
})

const pem = (opts = {}, type = 'pkcs1', extra = {}) =>
  generateKeyPairSync('rsa', {modulusLength: 2048, publicExponent: 65537, ...opts})
    .privateKey.export({type, format: 'pem', ...extra})

const keyName = () => uniq('parity-key')

async function add(a, name, key) {
  const res = await a.api('POST', '/adbkeys', {name, key})
  if (res.status === 201) mine.add(res.json.key.name)
  return res
}

async function del(a, file) {
  const res = await a.api('DELETE', `/adbkeys/${encodeURIComponent(file)}`)
  if (res.status === 200) mine.delete(file)
  return res
}

const list = async a => {
  const res = await a.get('/adbkeys')
  assert.equal(res.status, 200, res.text)
  return res.json
}
const others = keys => keys.filter(k => !k.name.startsWith('parity-')).map(k => JSON.stringify(k))
const mineIn = (keys, ...names) => keys.filter(k => names.includes(k.name))

function androidFingerprint(privatePem) {
  const jwk = crypto.createPublicKey(privatePem).export({format: 'jwk'})
  const n = BigInt('0x' + Buffer.from(jwk.n, 'base64url').toString('hex'))
  const e = parseInt(Buffer.from(jwk.e, 'base64url').toString('hex'), 16)
  const le = (v, bytes) => Buffer.from(v.toString(16).padStart(bytes * 2, '0'), 'hex').reverse()
  const mask = 0xffffffffn
  let inv = n & mask
  for (let i = 0; i < 5; i++) inv = (inv * (2n - (n & mask) * inv)) & mask
  const struct = Buffer.alloc(524)
  struct.writeUInt32LE(64, 0)
  struct.writeUInt32LE(Number((mask + 1n - inv) & mask), 4)
  le(n, 256).copy(struct, 8)
  le((1n << 4096n) % n, 256).copy(struct, 264)
  struct.writeUInt32LE(e, 520)
  return crypto.createHash('md5').update(struct).digest('hex').match(/../g).join(':')
}

const BAD_NAME = 'Bad Request: name may only use letters, digits, ".", "_" and "-" (max 64)'

test('backend 9.1: /adbkeys requires authentication', async () => {
  for (const [m, u] of [['GET', '/api/v1/adbkeys'], ['POST', '/api/v1/adbkeys'], ['DELETE', '/api/v1/adbkeys/x.adb_key']]) {
    const res = await raw(null, m, u, m === 'POST' ? {body: {name: 'x', key: 'y'}} : {})
    assert.equal(res.status, 401, `${m} ${u}`)
  }
})

test('backend 9.3: without a configured directory GET is 200 configured:false and POST/DELETE are 503 (vacuous when configured)', async t => {
  await withUsers(1, async a => {
    const res = await a.get('/adbkeys')
    assert.equal(res.status, 200)
    if (res.json.configured) return t.diagnostic('server has an ADB keys directory; unconfigured case not reachable')
    assert.deepEqual(res.json, {success: true, description: 'ADB keys directory not configured', configured: false, keys: []})
    const post = await a.api('POST', '/adbkeys', {name: keyName(), key: pem()})
    assert.equal(post.status, 503)
    assert.equal(post.json.description, 'Service Unavailable: no ADB keys directory configured')
    const d = await a.api('DELETE', '/adbkeys/x.adb_key')
    assert.equal(d.status, 503)
  })
})

test('backend 9.4: GET lists {configured:true, keys} with name, fingerprint, size, modified, loaded', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const key = pem()
    const res = await add(a, name, key)
    assert.equal(res.status, 201, res.text)
    const body = await list(a)
    assert.equal(body.success, true)
    assert.equal(body.description, 'ADB Keys Information')
    assert.equal(body.configured, true)
    const [k] = mineIn(body.keys, `${name}.adb_key`)
    assert.ok(k)
    assert.deepEqual(Object.keys(k).sort(), ['fingerprint', 'loaded', 'modified', 'name', 'size'])
    assert.equal(k.size, key.length)
    assert.equal(k.loaded, true)
    assert.equal(typeof k.fingerprint, 'string')
    assert.match(k.fingerprint, /^([0-9a-f]{2}:){15}[0-9a-f]{2}$/)
    assert.ok(Math.abs(Date.parse(k.modified) - Date.now()) < 60000)
    assert.match(k.modified, /^\d{4}-\d\d-\d\dT.*Z$/)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.4: fingerprint is the MD5 of the Android RSAPublicKey struct, colon-hex', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const key = pem()
    const res = await add(a, name, key)
    assert.equal(res.status, 201)
    const expected = androidFingerprint(key)
    assert.equal(res.json.key.fingerprint, expected)
    assert.equal(mineIn((await list(a)).keys, `${name}.adb_key`)[0].fingerprint, expected)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.4: listing is sorted by localeCompare on name', async () => {
  await withUsers(1, async a => {
    const base = keyName()
    const names = ['b', 'a', 'B-1', 'a_2', 'c-1'].map(s => `${base}-${s}`)
    for (const n of names) assert.equal((await add(a, n, pem())).status, 201)
    const keys = (await list(a)).keys.map(k => k.name)
    assert.deepEqual(keys, [...keys].sort((x, y) => x.localeCompare(y)))
    for (const n of names) await del(a, `${n}.adb_key`)
  })
})

test('backend 9.5 / B9.5: POST returns 201 {success, description:"Created (key)", key:{name, fingerprint}} with .adb_key appended', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const res = await add(a, name, pem())
    assert.equal(res.status, 201)
    assert.equal(res.json.success, true)
    assert.equal(res.json.description, 'Created (key)')
    assert.deepEqual(Object.keys(res.json.key).sort(), ['fingerprint', 'name'])
    assert.equal(res.json.key.name, `${name}.adb_key`)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.5: a name already ending in .adb_key is not suffixed twice', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const res = await add(a, `${name}.adb_key`, pem())
    assert.equal(res.status, 201)
    assert.equal(res.json.key.name, `${name}.adb_key`)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.5: PKCS#8 PEM is accepted as well as PKCS#1', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const res = await add(a, name, pem({}, 'pkcs8'))
    assert.equal(res.status, 201, res.text)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.5: public exponent 3 is accepted, other exponents are not', async () => {
  await withUsers(1, async a => {
    const n3 = keyName()
    const ok = await add(a, n3, pem({publicExponent: 3}))
    assert.equal(ok.status, 201, ok.text)
    await del(a, `${n3}.adb_key`)
    const bad = await add(a, keyName(), pem({publicExponent: 5}))
    assert.equal(bad.status, 400)
    assert.equal(bad.json.description, 'Bad Request: adb needs a 2048-bit RSA key')
  })
})

test('backend 9.5: key must be an unencrypted readable PEM private key, RSA 2048', async () => {
  await withUsers(1, async a => {
    const before = await list(a)
    const unreadable = 'Bad Request: not a readable unencrypted PEM private key'
    const cases = [
      [pem({}, 'pkcs8', {cipher: 'aes-256-cbc', passphrase: 'secret'}), unreadable]
    , ['not a key', unreadable]
    , [' ', unreadable]
    , [generateKeyPairSync('rsa', {modulusLength: 1024}).privateKey.export({type: 'pkcs1', format: 'pem'}), 'Bad Request: adb needs a 2048-bit RSA key']
    , [generateKeyPairSync('rsa', {modulusLength: 4096}).privateKey.export({type: 'pkcs1', format: 'pem'}), 'Bad Request: adb needs a 2048-bit RSA key']
    , [generateKeyPairSync('ec', {namedCurve: 'P-256'}).privateKey.export({type: 'pkcs8', format: 'pem'}), 'Bad Request: adb needs a 2048-bit RSA key']
    ]
    for (const [key, description] of cases) {
      const res = await add(a, keyName(), key)
      assert.equal(res.status, 400, res.text)
      assert.deepEqual(res.json, {success: false, description})
    }
    assert.deepEqual(others((await list(a)).keys), others(before.keys))
    assert.equal((await list(a)).keys.length, before.keys.length)
  })
})

test('backend 9.5: swagger limits (name <= 64, key <= 16384, both required) answer 400 Validation errors', async () => {
  await withUsers(1, async a => {
    for (const body of [
      {name: 'x'.repeat(65), key: pem()}
    , {name: keyName(), key: 'x'.repeat(16385)}
    , {name: keyName()}
    , {key: pem()}
    ]) {
      const res = await a.api('POST', '/adbkeys', body)
      assert.equal(res.status, 400)
      assert.equal(res.json.message, 'Validation errors')
    }
  })
})

test('backend 9.5: the FINAL file name must match the name pattern (letters, digits, ".", "_", "-"; max 64 incl. suffix)', async () => {
  await withUsers(1, async a => {
    const key = pem()
    for (const name of ['bad name', 'a/b', '.hidden', 'a'.repeat(57), 'a'.repeat(64), '', 'ü', 'a\\b', '..']) {
      const res = await add(a, name, key)
      assert.equal(res.status, 400, JSON.stringify(name))
      assert.deepEqual(res.json, {success: false, description: BAD_NAME}, JSON.stringify(name))
    }
    for (const name of ['-' + keyName(), '_' + keyName(), 'parity.' + keyName(), 'parity-' + 'a'.repeat(56 - 7)]) {
      const res = await add(a, name, key)
      assert.equal(res.status, 201, `${name}: ${res.text}`)
      await del(a, `${name}.adb_key`)
    }
  })
})

test('backend B9.2: an invalid name AND an invalid key returns the name error', async () => {
  await withUsers(1, async a => {
    const res = await add(a, 'bad name', 'garbage')
    assert.equal(res.status, 400)
    assert.equal(res.json.description, BAD_NAME)
  })
})

test('backend 9.5: an existing name is never overwritten (409 Conflict) and the first key stays', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const first = pem()
    assert.equal((await add(a, name, first)).status, 201)
    const second = await add(a, name, pem())
    assert.equal(second.status, 409)
    assert.deepEqual(second.json, {success: false, description: 'Conflict: a key with this name already exists'})
    const again = await add(a, `${name}.adb_key`, pem())
    assert.equal(again.status, 409)
    const k = mineIn((await list(a)).keys, `${name}.adb_key`)[0]
    assert.equal(k.fingerprint, androidFingerprint(first))
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.5: key text is stored verbatim, mode 0600 (file checks only where the directory is known)', async t => {
  if (TARGET !== 'old') return t.diagnostic('keys dir of the new server is not known to the tests')
  await withUsers(1, async a => {
    const name = keyName()
    const key = pem() + '\n\n'
    assert.equal((await add(a, name, key)).status, 201)
    const file = path.join(OLD_DIR, `${name}.adb_key`)
    assert.equal(fs.readFileSync(file, 'utf8'), key)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    await del(a, `${name}.adb_key`)
    assert.equal(fs.existsSync(file), false)
  })
})

test('backend 9.6: DELETE removes exactly the named file: 200 "Deleted (key)", then 404 "Not Found (key)"', async () => {
  await withUsers(1, async a => {
    const n1 = keyName()
    const n2 = keyName()
    assert.equal((await add(a, n1, pem())).status, 201)
    assert.equal((await add(a, n2, pem())).status, 201)
    const res = await del(a, `${n1}.adb_key`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, {success: true, description: 'Deleted (key)'})
    const gone = await del(a, `${n1}.adb_key`)
    assert.equal(gone.status, 404)
    assert.deepEqual(gone.json, {success: false, description: 'Not Found (key)'})
    const keys = (await list(a)).keys
    assert.equal(mineIn(keys, `${n1}.adb_key`).length, 0)
    assert.equal(mineIn(keys, `${n2}.adb_key`).length, 1)
    await del(a, `${n2}.adb_key`)
  })
})

test('backend 9.6: DELETE does not append the suffix (a bare name that has no file is 404)', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    assert.equal((await add(a, name, pem())).status, 201)
    const res = await a.api('DELETE', `/adbkeys/${name}`)
    assert.equal(res.status, 404)
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.6: DELETE rejects invalid names with 400 "Bad Request: invalid key name"', async () => {
  await withUsers(1, async a => {
    for (const name of ['.hidden', 'bad%20name', 'a'.repeat(65), 'a%5Cb']) {
      const res = await a.api('DELETE', `/adbkeys/${name}`)
      assert.equal(res.status, 400, name)
      assert.equal(res.json?.description ?? res.json?.message, 'Bad Request: invalid key name', name)
    }
  })
})

test('backend 9.4: files over 16384 bytes and unparsable keys cannot be created through the API (400), so every listed key is loaded', async () => {
  await withUsers(1, async a => {
    const mixed = (await list(a)).keys
    for (const k of mixed) {
      assert.equal(k.loaded, k.name.endsWith('.adb_key') && k.fingerprint !== null)
      assert.ok(k.fingerprint === null || /^([0-9a-f]{2}:){15}[0-9a-f]{2}$/.test(k.fingerprint))
      assert.ok(!k.name.startsWith('.'))
    }
  })
})

test('backend 9.7: the key content is never returned by any endpoint', async () => {
  await withUsers(1, async a => {
    const name = keyName()
    const res = await add(a, name, pem())
    assert.equal(res.status, 201)
    for (const r of [res, await a.get('/adbkeys')]) {
      assert.ok(!r.text.includes('PRIVATE KEY'))
      assert.ok(!/key"\s*:\s*"-----/.test(r.text))
    }
    await del(a, `${name}.adb_key`)
  })
})

test('backend 9.4 / 9.6: add then delete leaves the directory listing exactly as it was', async () => {
  await withUsers(1, async a => {
    const before = await list(a)
    const names = [keyName(), keyName()]
    for (const n of names) assert.equal((await add(a, n, pem())).status, 201)
    for (const n of names) assert.equal((await del(a, `${n}.adb_key`)).status, 200)
    const after = await list(a)
    assert.deepEqual(after.keys.filter(k => !k.name.startsWith('parity-')), before.keys.filter(k => !k.name.startsWith('parity-')))
  })
})
