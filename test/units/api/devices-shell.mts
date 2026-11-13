import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import sinon from 'sinon'
import type {Response} from 'express'
import type {ApiRequest, ShellCommandBody} from '../../../lib/types/units-api.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

type Device = {
  serial: string
  channel: string
  present: boolean
  ready: boolean
  owner: {name: string} | null
}

var devices: Device[] = []
var dbError: Error | null = null

var restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {
  default: {
    loadDevicesByOrigin: function() {
      return dbError ? Promise.reject(dbError) : Promise.resolve(devices)
    }
  }
})
let controller: any = null
let wire: any = null
let wireutil: any = null
try {
  controller = await importFresh(
    new URL('../../../lib/units/api/controllers/devices.js', import.meta.url)
  )
  wire = (await import('../../../lib/wire/index.js')).default
  wireutil = (await import('../../../lib/wire/util.js')).default
}
finally {
  restoreDb()
}

function device(serial: string, extra: Partial<Device> = {}): Device {
  return {serial, channel: 'ch-' + serial, present: true, ready: true, owner: null, ...extra}
}

function setup(body: ShellCommandBody) {
  let json: any = null
  let status = 0
  let done: () => void = function() {}
  var sent: Array<[string, Buffer]> = []
  var router = new EventEmitter()
  var sub = {subscribe: sinon.spy(), unsubscribe: sinon.spy()}
  var finished = new Promise<void>(function(resolve) {
    done = resolve
  })
  var res = {
    status: function(code: number) {
      status = code
      return res
    }
  , json: function(payload: unknown) {
      json = payload
      done()
      return res
    }
  } as unknown as Response
  var req = {
    body
  , user: {groups: {subscribed: ['g']}}
  , options: {
      sub
    , channelRouter: router
    , push: {send: function(msg: [string, Buffer]) {
        sent.push(msg)
      }}
    }
  } as unknown as ApiRequest<ShellCommandBody>
  return {
    req
  , res
  , sent
  , router
  , sub
  , finished
  , result: function() {
      return {status, json}
    }
  , channel: function() {
      return sub.subscribe.firstCall.args[0] as string
    }
  , deliver: function(message: unknown) {
      router.emit(sub.subscribe.firstCall.args[0], 'x', wireutil.envelope(message))
    }
  }
}

function progress(source: string, seq: number, data: string) {
  return new wire.TransactionProgressMessage(source, seq, data)
}

function doneMsg(source: string, seq: number, success: boolean, data?: string) {
  return new wire.TransactionDoneMessage(source, seq, success, data)
}

async function flush() {
  await new Promise(function(resolve) {
    setImmediate(resolve)
  })
}

describe('runShellOnDevices', function() {
  var clock: sinon.SinonFakeTimers | undefined

  beforeEach(function() {
    devices = []
    dbError = null
  })

  afterEach(function() {
    clock?.restore()
    clock = undefined
  })

  it('rejects a missing or empty command with 400', function() {
    var bodies = [{}, {command: ''}]
    bodies.forEach(function(body) {
      var t = setup(body)
      controller.runShellOnDevices(t.req, t.res)
      assert.equal(t.result().status, 400)
      assert.equal(t.result().json.description, 'Bad Request: missing command')
      assert.equal(t.sub.subscribe.callCount, 0)
    })
  })

  it('reports no eligible devices and releases the channel', async function() {
    devices = [device('a', {present: false}), device('b', {ready: false})]
    var t = setup({command: 'id'})
    await controller.runShellOnDevices(t.req, t.res)
    assert.equal(t.result().status, 200)
    assert.deepEqual(t.result().json.results, [])
    assert.deepEqual(t.result().json.skipped, [])
    assert.equal(t.result().json.description, 'No eligible devices')
    assert.equal(t.sub.unsubscribe.callCount, 1)
  })

  it('skips devices in use unless force is set', async function() {
    devices = [device('a'), device('b', {owner: {name: 'Bob'}})]
    var t = setup({command: 'id'})
    await controller.runShellOnDevices(t.req, t.res)
    assert.deepEqual(t.sent.map(function(m) {
      return m[0]
    }), ['ch-a'])
    t.deliver(doneMsg('a', 0, true))
    await t.finished
    assert.deepEqual(t.result().json.skipped, [{serial: 'b', reason: 'in use by Bob'}])
    assert.deepEqual(t.result().json.results, [{serial: 'a', success: true, data: ''}])

    var f = setup({command: 'id', force: true})
    await controller.runShellOnDevices(f.req, f.res)
    assert.deepEqual(f.sent.map(function(m) {
      return m[0]
    }), ['ch-a', 'ch-b'])
    assert.equal(f.result().status, 0)
  })

  it('sends the command and timeout to each device', async function() {
    devices = [device('a')]
    var t = setup({command: 'getprop ro.x', timeout: 3000})
    await controller.runShellOnDevices(t.req, t.res)
    var envelope = wire.Envelope.decode(t.sent[0]![1])
    var message = wire.ShellCommandMessage.decode(envelope.message)
    assert.equal(envelope.channel, t.channel())
    assert.equal(message.command, 'getprop ro.x')
    assert.equal(message.timeout, 3000)
    assert.ok(t.channel().startsWith('txn_'))

    var d = setup({command: 'id'})
    await controller.runShellOnDevices(d.req, d.res)
    var dm = wire.ShellCommandMessage.decode(wire.Envelope.decode(d.sent[0]![1]).message)
    assert.equal(dm.timeout, 10000)
  })

  it('orders chunks by seq even when Done overtakes them', async function() {
    devices = [device('a'), device('b')]
    var t = setup({command: 'id'})
    await controller.runShellOnDevices(t.req, t.res)
    t.deliver(doneMsg('a', 3, true))
    t.deliver(progress('a', 2, 'C'))
    t.deliver(progress('a', 0, 'A'))
    assert.equal(t.result().status, 0)
    t.deliver(progress('a', 1, 'B'))
    t.deliver(progress('b', 0, 'x'))
    t.deliver(doneMsg('b', 1, true))
    t.deliver(doneMsg('b', 1, false, 'ignored duplicate'))
    await t.finished
    assert.equal(t.result().json.description, 'Shell command completed')
    assert.deepEqual(t.result().json.results, [
      {serial: 'a', success: true, data: 'ABC'}
    , {serial: 'b', success: true, data: 'x'}
    ])
    assert.equal(t.sub.unsubscribe.callCount, 1)
    assert.equal(t.router.listenerCount(t.channel()), 0)
  })

  it('reports failures with the Done payload as error', async function() {
    devices = [device('a')]
    var t = setup({command: 'false'})
    await controller.runShellOnDevices(t.req, t.res)
    t.deliver(progress('a', 0, 'partial'))
    t.deliver(doneMsg('a', 1, false, 'exit 1'))
    await t.finished
    assert.deepEqual(t.result().json.results, [
      {serial: 'a', success: false, data: 'partial', error: 'exit 1'}
    ])
  })

  it('ignores messages from unknown sources', async function() {
    devices = [device('a')]
    var t = setup({command: 'id'})
    await controller.runShellOnDevices(t.req, t.res)
    t.deliver(doneMsg('zzz', 0, true))
    assert.equal(t.result().status, 0)
    t.deliver(doneMsg('a', 0, true))
    await t.finished
    assert.equal(t.result().json.results.length, 1)
  })

  it('answers after timeout + 5000 ms with what arrived', async function() {
    devices = [device('a'), device('b')]
    clock = sinon.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
    var t = setup({command: 'sleep 99', timeout: 2000})
    await controller.runShellOnDevices(t.req, t.res)
    t.deliver(progress('b', 0, 'half'))
    t.deliver(doneMsg('a', 0, true))
    clock.tick(6999)
    assert.equal(t.result().status, 0)
    clock.tick(1)
    assert.equal(t.result().json.description, 'Shell command timed out on some devices')
    assert.deepEqual(t.result().json.results, [
      {serial: 'a', success: true, data: ''}
    , {serial: 'b', success: null, data: ''}
    ])
    assert.equal(t.sub.unsubscribe.callCount, 1)
    t.deliver(doneMsg('b', 1, true))
    assert.equal(t.sub.unsubscribe.callCount, 1)
  })

  it('answers 500 and releases the channel when loading fails', async function() {
    dbError = new Error('db down')
    var t = setup({command: 'id'})
    await controller.runShellOnDevices(t.req, t.res)
    await flush()
    assert.equal(t.result().status, 500)
    assert.equal(t.sub.unsubscribe.callCount, 1)
  })
})
