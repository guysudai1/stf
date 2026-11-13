import {test, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {SERIAL, withUsers, lockDevice, unlockDevice, once, sleep} from '../harness.mjs'

before(lockDevice)
after(unlockDevice)

const update = async (socket, data) => {
  const err = once(socket, 'user.settings.update.error', 800).catch(() => null)
  socket.emit('user.settings.update', data)
  const error = await err
  await sleep(200)
  return error
}
const settings = async s => (await s.get('/user')).json.user.settings
const holder = async s => (await s.get(`/devices/${SERIAL}?fields=owner`)).json.device.owner

test('backend 2.1: invalid deviceTimeout values emit user.settings.update.error and are not stored', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    const cases = [
      ['x', 'deviceTimeout must be a finite number of milliseconds']
    , [[], 'deviceTimeout must be a finite number of milliseconds']
    , [1.5, 'deviceTimeout must be an integer number of milliseconds']
    , [86400001, 'deviceTimeout must not exceed 24 hours (86400000 milliseconds)']
    ]
    for (const [value, error] of cases) {
      assert.deepEqual(await update(socket, {deviceTimeout: value}), {error}, JSON.stringify(value))
    }
    assert.equal((await settings(a)).deviceTimeout, undefined)
  })
})

test('backend 2.1: valid values are stored; 0 and null are stored as null; 24h is the maximum', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    for (const [value, stored] of [[60000, 60000], [86400000, 86400000], [5, 5], [0, null], [-3, null], [null, null]]) {
      assert.equal(await update(socket, {deviceTimeout: value}), null, JSON.stringify(value))
      assert.equal((await settings(a)).deviceTimeout, stored, JSON.stringify(value))
    }
  })
})

test('backend 2.2: non-object changes emit an error and leave settings untouched', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 1234})
    for (const bad of [null, 'str']) {
      assert.deepEqual(await update(socket, bad), {error: 'User settings changes must be an object'})
    }
    assert.equal((await settings(a)).deviceTimeout, 1234)
  })
})

test('backend 2.3: settings updates merge instead of replacing', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {parityKeep: 'keep-me'})
    await update(socket, {deviceTimeout: 60000})
    assert.deepEqual(await settings(a), {parityKeep: 'keep-me', deviceTimeout: 60000})
  })
})

test('backend 2.4: user.settings.reset clears all settings', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 60000, parityKeep: 'x'})
    socket.emit('user.settings.reset')
    await sleep(400)
    assert.deepEqual(await settings(a), {})
  })
})

test('backend 2.5: explicit timeout on POST /user/devices releases the device after it elapses', async () => {
  await withUsers(1, async a => {
    assert.equal((await a.use(SERIAL, {timeout: 1500})).status, 200)
    assert.ok(await holder(a))
    await sleep(5000)
    assert.equal(await holder(a), null)
  })
})

test('backend 2.5: stored deviceTimeout applies when the request has none', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 1500})
    assert.equal((await a.use()).status, 200)
    assert.ok(await holder(a))
    await sleep(5000)
    assert.equal(await holder(a), null)
  })
})

test('backend 2.5: an explicit timeout wins over the stored one', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 1500})
    assert.equal((await a.use(SERIAL, {timeout: 60000})).status, 200)
    await sleep(5000)
    assert.ok(await holder(a))
  })
})

test('backend 2.5: with the stored timeout reset to null the device is held', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 1500})
    await update(socket, {deviceTimeout: 0})
    assert.equal((await a.use()).status, 200)
    await sleep(5000)
    assert.ok(await holder(a))
  })
})

test('backend B2.3: resetting through update stores deviceTimeout as null (key present)', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 60000})
    await update(socket, {deviceTimeout: null})
    assert.deepEqual(await settings(a), {deviceTimeout: null})
  })
})

test('backend B2.4: per-request timeout 0 falls through to the setting; a request above 24h is accepted', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    await update(socket, {deviceTimeout: 1500})
    assert.equal((await a.use(SERIAL, {timeout: 0})).status, 200)
    await sleep(5000)
    assert.equal(await holder(a), null)
    assert.equal((await a.use(SERIAL, {timeout: 90000000})).status, 200)
    await sleep(2500)
    assert.ok(await holder(a))
  })
})
