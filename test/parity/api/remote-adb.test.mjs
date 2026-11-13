import {test} from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {runCli, cliPath} from '../cli.mjs'

const scannerFile = path.join(path.dirname(cliPath), '../util/remote-adb-scanner.js')
let loaded
async function scanner() {
  loaded ??= import(pathToFileURL(scannerFile).href).then(m => {
    const d = m.default
    const create = typeof d === 'function' ? d : m.createScanner
    return {
      create
    , normalizeCIDR: m.normalizeCIDR ?? d?.normalizeCIDR
    , parsePorts: m.parsePorts ?? d?.parsePorts
    , validateConfig: m.validateConfig ?? d?.validateConfig
    , expandHosts: m.expandHosts ?? d?.expandHosts
    }
  })
  return loaded
}

const SUBNET_ERR = 'Remote ADB subnet must be an IPv4 CIDR'
const PORTS_EMPTY = 'Remote ADB ports must be a non-empty comma-separated list'
const PORTS_RANGE = 'Remote ADB ports must contain integers from 1 to 65535'
const LIMIT = 'Remote ADB subnet scan exceeds the 4096 address-port limit'
const INTERVAL = 'Remote ADB scan interval must be a positive integer'

const provider = (...args) => runCli(['provider', 'parity-serial', ...args], {timeout: 20000})
const local = (...args) => runCli(['local', ...args], {timeout: 20000})

test('backend 8.1: provider --help lists the three remote ADB options with their defaults', async () => {
  const out = await runCli(['provider', '--help'])
  assert.equal(out.code, 0, out.stderr)
  assert.match(out.stdout, /--remote-adb-subnet\s+IPv4 CIDR to scan for ADB-over-TCP devices\./)
  assert.match(out.stdout, /--remote-adb-ports\s+Comma-separated ADB-over-TCP ports to scan/)
  assert.match(out.stdout, /--remote-adb-scan-interval\s+Seconds between remote ADB scans/)
  assert.match(out.stdout, /\[default: 300\]/)
  assert.match(out.stdout, /\[default: "5555"\]/)
})

test('backend 8.1: local --help lists the three remote ADB options', async () => {
  const out = await runCli(['local', '--help'])
  assert.equal(out.code, 0, out.stderr)
  assert.match(out.stdout, /--remote-adb-subnet/)
  assert.match(out.stdout, /--remote-adb-ports/)
  assert.match(out.stdout, /--remote-adb-scan-interval/)
})

test('backend 8.1 / B8.1: an invalid --remote-adb-subnet fails at argument parse on provider', async () => {
  for (const bad of ['abc', '10.0.0.1/33', '10.0.0.1', '300.1.1.1/24', '10.0.0/24', '10.0.0.1/-1', '10.0.0.1/', '1.2.3.4/2x', '']) {
    const out = await provider('--remote-adb-subnet', bad)
    assert.notEqual(out.code, 0, JSON.stringify(bad))
    assert.ok(out.stderr.includes(SUBNET_ERR), `${JSON.stringify(bad)}: ${out.stderr.slice(-300)}`)
  }
})

test('backend 8.1 / B8.1: an invalid --remote-adb-subnet fails at argument parse on local', async () => {
  for (const bad of ['abc', '10.0.0.1/33']) {
    const out = await local('--remote-adb-subnet', bad)
    assert.notEqual(out.code, 0, bad)
    assert.ok(out.stderr.includes(SUBNET_ERR), `${bad}: ${out.stderr.slice(-300)}`)
  }
})

test('backend 8.1 / B8.1 / B8.4: invalid --remote-adb-ports fail at argument parse with the documented messages', async () => {
  const cases = [
    ['0', PORTS_RANGE], ['65536', PORTS_RANGE], ['abc', PORTS_RANGE], ['5555,abc', PORTS_RANGE]
  , ['-1', PORTS_RANGE], ['1.5', PORTS_RANGE]
  , ['', PORTS_EMPTY], ['5555,', PORTS_EMPTY], [',5555', PORTS_EMPTY], ['5555,,5556', PORTS_EMPTY]
  ]
  for (const [value, message] of cases) {
    for (const run of [provider, local]) {
      const out = await run('--remote-adb-ports', value)
      assert.notEqual(out.code, 0, JSON.stringify(value))
      assert.ok(out.stderr.includes(message), `${JSON.stringify(value)}: ${out.stderr.slice(-300)}`)
    }
  }
})

test('backend 8.3 / 8.2 / 8.4: normalizeCIDR canonicalises, trims and rejects malformed input', async () => {
  const s = await scanner()
  assert.equal(s.normalizeCIDR('192.168.1.77/24').cidr, '192.168.1.0/24')
  assert.equal(s.normalizeCIDR('  10.0.0.77/24 ').cidr, '10.0.0.0/24')
  assert.equal(s.normalizeCIDR('10.1.2.3/32').cidr, '10.1.2.3/32')
  assert.equal(s.normalizeCIDR('10.1.2.3/0').cidr, '0.0.0.0/0')
  assert.equal(s.normalizeCIDR('10.1.2.3/31').cidr, '10.1.2.2/31')
  const n = s.normalizeCIDR('192.168.1.77/24')
  assert.equal(n.prefix, 24)
  assert.equal(n.size, 256)
  for (const bad of ['', 'abc', '1.2.3/24', '1.2.3.4', '1.2.3.4/33', '1.2.3.4/-1', '256.1.1.1/24', '1.2.3.4/a', '1.2.3.4/24/1', '1.a.3.4/24', ' /24', '1.2.3.4/ 24', null, 5]) {
    assert.throws(() => s.normalizeCIDR(bad), {message: SUBNET_ERR}, JSON.stringify(bad))
  }
})

test('backend 8.1 / B8.4: parsePorts splits, trims, dedupes and validates', async () => {
  const s = await scanner()
  assert.deepEqual([...s.parsePorts('5555')], [5555])
  assert.deepEqual([...s.parsePorts('5555, 5556 ,5555,1,65535')], [5555, 5556, 1, 65535])
  assert.deepEqual([...s.parsePorts(['5555', ' 6000 '])], [5555, 6000])
  for (const bad of ['', '5555,', ',5555', '5555,,6000', ' ', []]) {
    assert.throws(() => s.parsePorts(bad), {message: PORTS_EMPTY}, JSON.stringify(bad))
  }
  for (const bad of ['0', '65536', 'abc', '5555,x', '-1', '1.5', '0x10', '1e3']) {
    assert.throws(() => s.parsePorts(bad), {message: PORTS_RANGE}, JSON.stringify(bad))
  }
})

test('backend 8.2 / B8.2: scan cap is hosts * ports <= 4096 (network and broadcast excluded below /31)', async () => {
  const s = await scanner()
  assert.doesNotThrow(() => s.validateConfig({subnet: '10.0.0.0/20', ports: '5555'}))
  assert.throws(() => s.validateConfig({subnet: '10.0.0.0/19', ports: '5555'}), {message: LIMIT})
  assert.throws(() => s.validateConfig({subnet: '10.0.0.0/0'}), {message: LIMIT})
  assert.doesNotThrow(() => s.validateConfig({subnet: '10.0.0.0/21', ports: '5555,5556'}))
  assert.throws(() => s.validateConfig({subnet: '10.0.0.0/21', ports: '5555,5556,5557'}), {message: LIMIT})
  assert.doesNotThrow(() => s.validateConfig({subnet: '10.0.0.0/20', ports: '5555'}), '4094 hosts fit')
  assert.throws(() => s.validateConfig({subnet: '10.0.0.0/20', ports: '5555,5556'}), {message: LIMIT})
  assert.doesNotThrow(() => s.validateConfig({subnet: '10.0.0.1/32', ports: '5555'}))
  assert.doesNotThrow(() => s.validateConfig({subnet: '10.0.0.0/31', ports: '5555'}))
})

test('backend 8.2: interval must be a positive integer; ports default to 5555, interval to 300', async () => {
  const s = await scanner()
  for (const bad of [0, -1, 1.5, 'abc', NaN]) {
    assert.throws(() => s.validateConfig({subnet: '10.0.0.0/24', intervalSeconds: bad}), {message: INTERVAL}, String(bad))
  }
  const c = s.validateConfig({subnet: '10.0.0.77/24'})
  assert.equal(c.enabled, true)
  assert.equal(c.intervalSeconds, 300)
  assert.deepEqual([...c.ports], [5555])
  assert.equal(c.subnet.cidr, '10.0.0.0/24')
  const off = s.validateConfig({})
  assert.equal(off.enabled, false)
  assert.deepEqual([...off.ports], [5555])
  assert.equal(off.intervalSeconds, 300)
  assert.throws(() => s.validateConfig({ports: ''}), {message: PORTS_EMPTY})
  assert.throws(() => s.validateConfig({intervalSeconds: 0}), {message: INTERVAL})
})

test('backend B8.2: expandHosts excludes network and broadcast below /31, /32 is one host, /31 is both', async () => {
  const s = await scanner()
  const h24 = s.expandHosts('10.0.0.5/24')
  assert.equal(h24.length, 254)
  assert.equal(h24[0], '10.0.0.1')
  assert.equal(h24.at(-1), '10.0.0.254')
  assert.deepEqual(s.expandHosts('10.0.0.5/32'), ['10.0.0.5'])
  assert.deepEqual(s.expandHosts('10.0.0.5/31'), ['10.0.0.4', '10.0.0.5'])
  assert.deepEqual(s.expandHosts('10.0.0.0/30'), ['10.0.0.1', '10.0.0.2'])
})

async function listener() {
  const sockets = new Set()
  const server = net.createServer(sock => {
    sockets.add(sock)
    sock.on('error', () => {})
    sock.on('close', () => sockets.delete(sock))
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  return {
    port: server.address().port
  , close: () => {
      for (const s of sockets) s.destroy()
      server.close()
    }
  }
}

async function freePort() {
  const l = await listener()
  const {port} = l
  l.close()
  await new Promise(r => setTimeout(r, 200))
  return port
}

test('backend 8.3 / 8.4 / B8.5: a scan of 127.0.0.1/32 connects to the open port only and reports per-cycle counters', async () => {
  const s = await scanner()
  const open = await listener()
  const closed = await freePort()
  const calls = []
  const infos = []
  try {
    const scan = s.create({
      subnet: '127.0.0.1/32'
    , ports: `${open.port},${closed}`
    , intervalSeconds: 3600
    , client: {connect: (host, port) => { calls.push([host, port]); return Promise.resolve() }}
    , log: {info: (...a) => infos.push(a), warn: () => {}}
    })
    const result = await scan.start()
    scan.stop()
    assert.deepEqual(calls, [['127.0.0.1', open.port]])
    assert.deepEqual({...result}, {responsive: 1, connected: 1, failed: 0})
    assert.equal(infos.length, 1)
    assert.deepEqual(infos[0], [
      'Remote ADB scan %s: %d responsive endpoint(s), %d connected, %d failed'
    , '127.0.0.1/32', 1, 1, 0
    ])
  }
  finally {
    open.close()
  }
})

test('backend 8.3 / B8.5: a failing adb connect counts as failed, is logged as a warning and does not abort the cycle', async () => {
  const s = await scanner()
  const a = await listener()
  const b = await listener()
  const warns = []
  try {
    const scan = s.create({
      subnet: '127.0.0.1/32'
    , ports: `${a.port},${b.port}`
    , intervalSeconds: 3600
    , client: {connect: (host, port) => port === a.port ? Promise.reject(new Error('boom')) : Promise.resolve()}
    , log: {info: () => {}, warn: (...x) => warns.push(x)}
    })
    const result = await scan.start()
    scan.stop()
    assert.deepEqual({...result}, {responsive: 2, connected: 1, failed: 1})
    assert.deepEqual(warns, [['Remote ADB connect failed for %s:%d: %s', '127.0.0.1', a.port, 'boom']])
  }
  finally {
    a.close()
    b.close()
  }
})

test('backend 8.4: the first cycle runs immediately on start and a stopped scanner does nothing', async () => {
  const s = await scanner()
  const open = await listener()
  let n = 0
  try {
    const scan = s.create({
      subnet: '127.0.0.1/32', ports: String(open.port), intervalSeconds: 3600
    , client: {connect: () => { n += 1; return Promise.resolve() }}
    , log: {info: () => {}, warn: () => {}}
    })
    const started = Date.now()
    await scan.start()
    assert.ok(Date.now() - started < 1500)
    assert.equal(n, 1)
    scan.stop()
    const again = await scan.start()
    assert.deepEqual({...again}, {responsive: 0, connected: 0, failed: 0})
    assert.equal(n, 1)
  }
  finally {
    open.close()
  }
})

test('backend 8.2: a bad config also throws when the scanner is constructed', async () => {
  const s = await scanner()
  assert.throws(() => s.create({subnet: 'nope', client: {}}), {message: SUBNET_ERR})
  assert.throws(() => s.create({subnet: '10.0.0.0/24', intervalSeconds: 0, client: {}}), {message: INTERVAL})
  assert.throws(() => s.create({subnet: '10.0.0.0/8', client: {}}), {message: LIMIT})
})
