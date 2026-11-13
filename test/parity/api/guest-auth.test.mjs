import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isNew, Jar, raw, jwtHeader, cookieJson, login, uniq, sleep} from '../harness.mjs'

const post = (jar, body, headers) => raw(jar, 'POST', '/auth/api/v1/guest', {body, headers})
const open = async () => {
  const jar = new Jar()
  await raw(jar, 'GET', '/auth/guest/')
  return jar
}

test('backend 1.1: GET /auth/guest/ renders and creates a stable guest-<32hex> id in the session', async () => {
  const jar = new Jar()
  const res = await raw(jar, 'GET', '/auth/guest/')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /html/)
  const id = cookieJson(jar.get('ssid')).guestId
  assert.match(id, /^guest-[0-9a-f]{32}$/)
  await raw(jar, 'GET', '/auth/guest/')
  assert.equal(cookieJson(jar.get('ssid')).guestId, id)
})

test('backend 1.2: GET / redirects to /auth/guest/', async () => {
  const res = await raw(null, 'GET', '/')
  assert.equal(res.status, 302)
  assert.match(res.headers.get('location'), /\/auth\/guest\/$/)
})

test('backend 1.3: nickname validation rejects empty, blank and over 64 chars with 400 ValidationError', async () => {
  const jar = await open()
  for (const name of ['', '   ', 'x'.repeat(65), undefined]) {
    const res = await post(jar, name === undefined ? {} : {name})
    assert.equal(res.status, 400, JSON.stringify(name))
    assert.equal(res.json.success, false)
    assert.equal(res.json.error, 'ValidationError')
    assert.ok(res.json.validationErrors)
  }
})

test('backend 1.3: nickname is trimmed, 64 chars and arbitrary characters are accepted', async () => {
  const jar = await open()
  const res = await post(jar, {name: '  Pad <b>é</b>  '})
  assert.equal(res.status, 200)
  assert.equal(res.json.success, true)
  await raw(jar, 'GET', res.json.redirect)
  const me = await raw(jar, 'GET', '/api/v1/user')
  assert.equal(me.json.user.name, 'Pad <b>é</b>')
  const long = await open()
  assert.equal((await post(long, {name: 'x'.repeat(64)})).status, 200)
})

test('backend 1.4: guest email is <guestId>@guest.local', async () => {
  const s = await login(uniq('g14'))
  assert.match(s.email, /^guest-[0-9a-f]{32}@guest\.local$/)
  assert.equal(s.email, `${cookieJson(s.jar.get('ssid')).guestId}@guest.local`)
})

test('backend 1.4: POST without a prior GET still creates the guestId', async () => {
  const jar = new Jar()
  await raw(jar, 'GET', '/auth/contact')
  const res = await post(jar, {name: uniq('g14b')})
  assert.equal(res.status, 200)
  assert.match(cookieJson(jar.get('ssid')).guestId, /^guest-[0-9a-f]{32}$/)
})

test('backend 1.5: same cookie, same name succeeds again; different name is 409 NicknameAlreadySet', async () => {
  const jar = await open()
  const name = uniq('g15')
  assert.equal((await post(jar, {name})).status, 200)
  assert.equal((await post(jar, {name})).status, 200)
  const res = await post(jar, {name: name + '-other'})
  assert.equal(res.status, 409)
  assert.deepEqual(res.json, {success: false, error: 'NicknameAlreadySet'})
})

test('backend 1.5: two independent identities may use the same nickname', async () => {
  const name = uniq('g15dup')
  const a = await open()
  const b = await open()
  assert.equal((await post(a, {name})).status, 200)
  assert.equal((await post(b, {name})).status, 200)
})

test('backend 1.6: non-JSON Accept gets 406', async () => {
  const jar = await open()
  const res = await post(jar, {name: uniq('g16')}, {Accept: 'text/html'})
  assert.equal(res.status, 406)
})

test('backend 1.7: success returns redirect to the app with a jwt carrying email and name', async () => {
  const jar = await open()
  const name = uniq('g17')
  const res = await post(jar, {name})
  assert.equal(res.status, 200)
  assert.equal(res.json.success, true)
  const url = new URL(res.json.redirect)
  const jwt = url.searchParams.get('jwt')
  assert.ok(jwt)
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
  assert.equal(payload.name, name)
  assert.equal(payload.email, `${cookieJson(jar.get('ssid')).guestId}@guest.local`)
})

test('backend 1.7: jwt exp is now + 24h (old: + 86400 ms, an intended fix)', async () => {
  const jar = await open()
  const before = Date.now()
  const res = await post(jar, {name: uniq('g17e')})
  const exp = jwtHeader(new URL(res.json.redirect).searchParams.get('jwt')).exp
  const ttl = isNew ? 86400 * 1000 : 86400
  assert.ok(exp >= before + ttl - 5000 && exp <= Date.now() + ttl, `exp ${exp - before}`)
})

test('backend 1.9: logout answers 200 and ends the session; next visit is a new identity', async () => {
  const s = await login(uniq('g19'))
  const before = cookieJson(s.jar.get('ssid')).guestId
  const res = await raw(s.jar, 'POST', '/auth/api/v1/logout')
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, {success: true})
  assert.equal((await raw(s.jar, 'GET', '/api/v1/user')).status, 401)
  await raw(s.jar, 'GET', '/auth/guest/')
  assert.notEqual(cookieJson(s.jar.get('ssid')).guestId, before)
})

test('backend 1.9: the guest user row remains after logout', async () => {
  const [a, b] = [await login(uniq('g19a')), await login(uniq('g19b'))]
  await raw(a.jar, 'POST', '/auth/api/v1/logout')
  const res = await b.get(`/users/${encodeURIComponent(a.email)}`)
  assert.equal(res.status, 200)
})

test('backend 1.10: GET /auth/contact returns the root group owner and sets an XSRF cookie', async () => {
  const jar = new Jar()
  const res = await raw(jar, 'GET', '/auth/contact')
  assert.equal(res.status, 200)
  assert.equal(res.json.success, true)
  assert.equal(typeof res.json.contact.email, 'string')
  assert.equal(typeof res.json.contact.name, 'string')
  assert.ok(jar.get('XSRF-TOKEN'))
})

test('backend 1.11: POST without a valid CSRF token is rejected with 403', async () => {
  const jar = await open()
  const res = await post(jar, {name: uniq('g111')}, {'X-XSRF-TOKEN': 'bad'})
  assert.equal(res.status, 403)
  const none = await raw(new Jar(), 'POST', '/auth/api/v1/guest', {body: {name: 'x'}})
  assert.equal(none.status, 403)
})

test('backend 1.14: a new guest is admin on first login', async () => {
  const s = await login(uniq('g114'))
  assert.equal(s.user.privilege, 'admin')
})

test('backend B1.1: /auth/guest without trailing slash and unknown paths are 404', async () => {
  assert.equal((await raw(null, 'GET', '/auth/guest')).status, 404)
  assert.equal((await raw(null, 'GET', '/auth/Guest/')).status, 404)
})

test('backend B1.2: the guest session cookie is the app session; logout destroys it', async () => {
  const s = await login(uniq('b12'))
  assert.equal((await s.get('/user')).status, 200)
  assert.equal(cookieJson(s.jar.get('ssid')).guestId.startsWith('guest-'), true)
  assert.ok(cookieJson(s.jar.get('ssid')).jwt)
  await raw(s.jar, 'POST', '/auth/api/v1/logout')
  assert.equal((await s.get('/user')).status, 401)
})

test('backend B1.3: redirect jwt is still accepted after 90 s (old rejects it: an intended fix)', {timeout: 120000}, async () => {
  const jar = new Jar()
  await raw(jar, 'GET', '/auth/guest/')
  const res = await post(jar, {name: uniq('b13')})
  await sleep(90000)
  await raw(jar, 'GET', res.json.redirect)
  assert.equal((await raw(jar, 'GET', '/api/v1/user')).status, isNew ? 200 : 401)
})

test('backend B1.4: a new guest belongs to the Common (root) group with empty settings and forwards', async () => {
  const s = await login(uniq('b14'))
  assert.deepEqual(s.user.settings, {})
  assert.deepEqual(s.user.forwards, [])
  const root = (await s.get('/groups')).json.groups.find(g => g.privilege === 'root')
  assert.ok(root.users.includes(s.email))
  assert.ok(s.user.groups.subscribed.includes(root.id))
})

test('backend B1.5: a repeat POST with the same name issues a fresh jwt and updates lastLoggedInAt', async () => {
  const s = await login(uniq('b15'))
  const first = s.user.lastLoggedInAt
  await sleep(1100)
  const res = await post(s.jar, {name: s.user.name})
  assert.equal(res.status, 200)
  await raw(s.jar, 'GET', res.json.redirect)
  const again = (await s.get('/user')).json.user
  assert.ok(Date.parse(again.lastLoggedInAt) > Date.parse(first))
})
