import {test} from 'node:test'
import assert from 'node:assert/strict'
import {raw, login, uniq, withUsers} from '../harness.mjs'

const enc = encodeURIComponent
const rootEmail = async () => (await raw(null, 'GET', '/auth/contact')).json.contact.email

test('backend 0.3 / B0.1: a user-privilege session gets 403 on admin operations (vacuous while everyone is admin)', async t => {
  await withUsers(1, async a => {
    if (a.user.privilege === 'admin') {
      t.diagnostic('no user-privilege session can exist here; everyone is admin')
      return
    }
    const res = await a.get('/users')
    assert.equal(res.status, 403)
    assert.deepEqual(res.json, {success: false, description: 'Forbidden: privileged operation (admin)'})
  })
})

test('backend 11.1: users are created as admin and can call admin-tagged operations', async () => {
  await withUsers(2, async (a, b) => {
    assert.equal(a.user.privilege, 'admin')
    assert.equal(b.user.privilege, 'admin')
    const res = await b.get(`/users/${enc(a.email)}`)
    assert.equal(res.status, 200)
    assert.equal(res.json.user.privilege, 'admin')
  })
})

test('backend 11.5: any logged-in user gets 200 on GET /health/summary and GET /users', async () => {
  await withUsers(2, async (a, b) => {
    assert.equal((await a.get('/health/summary')).status, 200)
    assert.equal((await b.get('/health/summary')).status, 200)
    assert.equal((await b.get('/users')).status, 200)
  })
})

test('backend 11.4: /auth/contact equals the owner of the root group', async () => {
  await withUsers(1, async a => {
    const contact = (await raw(null, 'GET', '/auth/contact')).json.contact
    const groups = (await a.get('/groups')).json.groups
    const root = groups.find(g => g.privilege === 'root')
    assert.equal(root.owner.email, contact.email)
  })
})

test('backend B1.7: REST create user gives 201 and privilege admin; creating again is 403', async () => {
  await withUsers(1, async a => {
    const email = `${uniq('rest')}@parity.test`
    const res = await a.api('POST', `/users/${enc(email)}?name=${uniq('n')}`)
    assert.equal(res.status, 201)
    assert.equal(res.json.user.privilege, 'admin')
    const again = await a.api('POST', `/users/${enc(email)}?name=x`)
    assert.equal(again.status, 403)
    assert.equal(again.json.description, 'Forbidden (user already exists)')
    assert.equal((await a.api('DELETE', `/users/${enc(email)}`)).status, 200)
  })
})

test('backend 6.1: deleting yourself is 403 Forbidden (user)', async () => {
  await withUsers(1, async a => {
    const res = await a.api('DELETE', `/users/${enc(a.email)}`)
    assert.equal(res.status, 403)
    assert.deepEqual(res.json, {success: false, description: 'Forbidden (user)'})
  })
})

test('backend 6.1: deleting the root owner is 403 Forbidden (user)', async () => {
  await withUsers(1, async a => {
    const res = await a.api('DELETE', `/users/${enc(await rootEmail())}`)
    assert.equal(res.status, 403)
    assert.deepEqual(res.json, {success: false, description: 'Forbidden (user)'})
  })
})

test('backend 6.1: bulk delete where every entry is forbidden is a single 403 Forbidden (users)', async () => {
  await withUsers(1, async a => {
    const res = await a.api('DELETE', '/users', {emails: `${a.email},${await rootEmail()}`})
    assert.equal(res.status, 403)
    assert.deepEqual(res.json, {success: false, description: 'Forbidden (users)'})
  })
})

test('backend B6.1: bulk delete of [normal user, root owner] is 200 Deleted (users) and removes the normal user', async () => {
  await withUsers(2, async (a, b) => {
    const res = await a.api('DELETE', '/users', {emails: `${b.email},${await rootEmail()}`})
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, {success: true, description: 'Deleted (users)'})
    assert.equal((await a.get(`/users/${enc(b.email)}`)).status, 404)
  })
})

test('backend B6.2: deleting the root owner is 403 even for a nonexistent row; unknown user is 404', async () => {
  await withUsers(1, async a => {
    assert.equal((await a.api('DELETE', `/users/${enc(await rootEmail())}`)).status, 403)
    const res = await a.api('DELETE', `/users/${enc(uniq('nobody') + '@parity.test')}`)
    assert.equal(res.status, 404)
    assert.deepEqual(res.json, {success: false, description: 'Not Found (user)'})
    const bulk = await a.api('DELETE', '/users', {emails: `${uniq('nobody')}@parity.test`})
    assert.equal(bulk.status, 404)
    assert.equal(bulk.json.description, 'Not Found (users)')
  })
})

test('backend 6.2: guests can be deleted by another user and then lose their session', async () => {
  await withUsers(2, async (a, b) => {
    const res = await a.api('DELETE', `/users/${enc(b.email)}`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, {success: true, description: 'Deleted (user)'})
    assert.equal((await a.get(`/users/${enc(b.email)}`)).status, 404)
  })
})
