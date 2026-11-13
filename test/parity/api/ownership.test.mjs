import {test, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {SERIAL, withUsers, lockDevice, unlockDevice, once} from '../harness.mjs'

before(lockDevice)
after(unlockDevice)

const device = (s, fields) => s.get(`/devices/${SERIAL}${fields ? `?fields=${fields}` : ''}`)

test('backend 5.1: using is true for the owner and false for everyone else, owner is set for both', async () => {
  await withUsers(2, async (a, b) => {
    assert.equal((await a.use()).status, 200)
    const mine = (await device(a, 'using,owner.email')).json.device
    const theirs = (await device(b, 'using,owner.email')).json.device
    assert.equal(mine.using, true)
    assert.equal(theirs.using, false)
    assert.equal(mine.owner.email, a.email)
    assert.equal(theirs.owner.email, a.email)
  })
})

test('backend 5.1: using is false for nobody-owned devices', async () => {
  await withUsers(1, async a => {
    const d = (await device(a, 'using,owner')).json.device
    assert.deepEqual(d, {using: false, owner: null})
  })
})

test('backend 5.1: websocket device.change carries using=false to a non-owner', async () => {
  await withUsers(2, async (a, b) => {
    const socket = await b.socket()
    const change = once(socket, 'device.change', 6000)
    assert.equal((await a.use()).status, 200)
    const msg = await change
    assert.equal(msg.data.serial, SERIAL)
    assert.equal(msg.data.using, false)
    assert.equal(msg.data.owner.email, a.email)
  })
})

test('backend 0.1: another user can GET the owned device through /user/devices/{serial} (admin clause)', async () => {
  await withUsers(2, async (a, b) => {
    await a.use()
    const res = await b.get(`/user/devices/${SERIAL}`)
    assert.equal(res.status, 200)
    assert.equal(res.json.success, true)
    assert.equal(res.json.device.serial, SERIAL)
  })
})

test('backend 0.2: a device owned by someone else is not addable by another user', async () => {
  await withUsers(2, async (a, b) => {
    await a.use()
    const res = await b.use()
    assert.equal(res.status, 403)
    assert.deepEqual(res.json, {success: false, description: 'Device is being used or not available'})
  })
})

test('backend 5.3: ?fields= picks from the published device shape', async () => {
  await withUsers(1, async a => {
    await a.use()
    const res = await device(a, 'using,owner.email,serial,nonexistent')
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.device, {using: true, owner: {email: a.email}, serial: SERIAL})
  })
})

test('backend 5.4: another user can force-release a held device with DELETE /user/devices/{serial}', async () => {
  await withUsers(2, async (a, b) => {
    await a.use()
    const res = await b.stop()
    assert.equal(res.status, 200)
    assert.deepEqual(res.json, {success: true, description: 'Device successfully removed'})
    assert.equal((await device(a, 'owner')).json.device.owner, null)
    assert.equal((await b.use()).status, 200)
  })
})

test('backend B5.1: GET /user/devices/{serial}?fields= picks from the raw device (using is included)', async () => {
  await withUsers(1, async a => {
    await a.use()
    const res = await a.get(`/user/devices/${SERIAL}?fields=serial,using,nonexistent`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.json.device, {serial: SERIAL, using: true})
  })
})
