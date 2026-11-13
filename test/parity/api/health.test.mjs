import {test, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {SERIAL, isNew, raw, login, withUsers, lockDevice, unlockDevice, once, sleep} from '../harness.mjs'

before(lockDevice)
after(unlockDevice)

const DAY = 86400000
const LEVELS = {3: 'info', 4: 'important', 5: 'warning', 6: 'error', 7: 'fatal'}
const ROW_KEYS = [
  'details', 'health', 'id', 'identifier', 'kind', 'levelLabel', 'message'
, 'messageSummary', 'pid', 'priority', 'serial', 'severity', 'tag', 'timestamp'
]
const SOCKET_KEYS = ROW_KEYS.filter(k => k !== 'id' && k !== 'health')

const logs = async (s, query = '') => {
  const res = await s.get('/health/logs' + query)
  assert.equal(res.status, 200, res.text)
  return res.json.logs
}
const text = row => [row.message, row.tag, row.identifier, isNew ? row.serial : ''].join('\n').toLowerCase()

async function waitLogs(s, query, pred, ms = 8000) {
  const end = Date.now() + ms
  let rows = []
  while (Date.now() < end) {
    rows = await logs(s, query)
    if (pred(rows)) return rows
    await sleep(300)
  }
  return rows
}

test('backend 3.14: GET /health/summary and /health/logs are 200 with the documented envelope', async () => {
  await withUsers(1, async a => {
    const s = await a.get('/health/summary')
    assert.equal(s.status, 200)
    assert.equal(s.json.success, true)
    assert.equal(s.json.description, 'Health summary')
    assert.equal(typeof s.json.summary, 'object')
    const l = await a.get('/health/logs')
    assert.equal(l.status, 200)
    assert.equal(l.json.success, true)
    assert.equal(l.json.description, 'Health logs')
    assert.ok(Array.isArray(l.json.logs))
  })
})

test('backend 3.14: health endpoints require authentication', async () => {
  for (const url of ['/api/v1/health/summary', '/api/v1/health/logs']) {
    const res = await raw(null, 'GET', url)
    assert.equal(res.status, 401)
    assert.deepEqual(res.json, {success: false, description: 'Requires Authentication'})
  }
})

test('backend 3.5: summary has the documented shape and a 24h window', async () => {
  await withUsers(1, async a => {
    const {summary} = (await a.get('/health/summary')).json
    assert.deepEqual(Object.keys(summary).sort()
    , ['cutoff', 'devices', 'generatedAt', 'logs', 'status', 'statusDescription', 'windowMs'])
    assert.equal(summary.windowMs, DAY)
    assert.deepEqual(Object.keys(summary.devices).sort(), ['present', 'ready', 'total'])
    assert.deepEqual(Object.keys(summary.logs).sort(), ['error', 'fatal', 'levels', 'total', 'warning'])
    for (const k of ['total', 'present', 'ready']) assert.equal(typeof summary.devices[k], 'number')
    assert.ok(summary.devices.total >= summary.devices.present)
    assert.ok(summary.devices.total >= summary.devices.ready)
    const generated = Date.parse(summary.generatedAt)
    assert.ok(Math.abs(generated - Date.now()) < 60000)
    assert.ok(Math.abs(generated - Date.parse(summary.cutoff) - DAY) < 1000)
    assert.match(summary.generatedAt, /^\d{4}-\d\d-\d\dT.*Z$/)
    assert.match(summary.cutoff, /^\d{4}-\d\d-\d\dT.*Z$/)
  })
})

test('backend 3.5 / B3.5: levels is keyed by numeric priority, total is the sum, warning/error/fatal are 5/6/7', async () => {
  await withUsers(1, async a => {
    const {logs: l} = (await a.get('/health/summary')).json.summary
    for (const [k, v] of Object.entries(l.levels)) {
      assert.match(k, /^[1-7]$/)
      assert.ok(Number.isInteger(v) && v > 0, 'only priorities that have rows are listed')
    }
    assert.equal(l.total, Object.values(l.levels).reduce((n, v) => n + v, 0))
    assert.equal(l.warning, l.levels[5] || 0)
    assert.equal(l.error, l.levels[6] || 0)
    assert.equal(l.fatal, l.levels[7] || 0)
  })
})

test('backend 3.5: status precedence fatal > error > warning > healthy with the exact descriptions', async () => {
  await withUsers(1, async a => {
    const {summary} = (await a.get('/health/summary')).json
    const l = summary.logs
    const expected = l.fatal ? ['critical', 'Critical: fatal events were recorded in the last 24 hours.']
      : l.error ? ['degraded', 'Degraded: error events were recorded in the last 24 hours.']
        : l.warning ? ['warning', 'Warning: warning events were recorded in the last 24 hours.']
          : ['healthy', 'No warning or higher events were recorded in the last 24 hours.']
    assert.deepEqual([summary.status, summary.statusDescription], expected)
  })
})

test('backend 3.5: summary log counts agree with /health/logs over the same window', async () => {
  await withUsers(1, async a => {
    const before = (await a.get('/health/summary')).json.summary.logs
    const rows = await logs(a, '?limit=1000')
    const after = (await a.get('/health/summary')).json.summary.logs
    if (after.total > 1000) return
    const n = rows.length
    assert.ok(n >= before.total && n <= after.total, `${before.total} <= ${n} <= ${after.total}`)
  })
})

test('backend 3.4: logs are newest first and all inside the last 24h', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    const stamps = rows.map(r => Date.parse(r.timestamp))
    for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i - 1] >= stamps[i], 'descending')
    for (const t of stamps) assert.ok(t >= Date.now() - DAY - 5000)
  })
})

test('backend 3.4: default limit is 200 and the cap is 1000', async () => {
  await withUsers(1, async a => {
    const total = (await a.get('/health/summary')).json.summary.logs.total
    const def = await logs(a)
    assert.ok(def.length <= 200)
    if (total >= 210) assert.equal(def.length, 200)
    const big = await logs(a, '?limit=1000')
    assert.ok(big.length <= 1000)
    assert.ok(big.length >= def.length)
  })
})

test('backend 3.4 / B3.4: limit applies after the filters (newest N matching rows)', async () => {
  await withUsers(1, async a => {
    const all = await logs(a, '?limit=1000&priority=5')
    const few = await logs(a, '?limit=2&priority=5')
    assert.equal(few.length, Math.min(2, all.length))
    for (const r of few) assert.ok(r.priority >= 5)
    assert.deepEqual(few.map(r => r.id), all.slice(0, few.length).map(r => r.id))
    const rare = await logs(a, '?limit=1&priority=7')
    const rareAll = await logs(a, '?limit=1000&priority=7')
    assert.equal(rare.length, Math.min(1, rareAll.length))
  })
})

test('backend 3.4: priority filter is >= (not equals)', async () => {
  await withUsers(1, async a => {
    for (const p of [4, 5, 6, 7]) {
      const rows = await logs(a, `?limit=1000&priority=${p}`)
      for (const r of rows) assert.ok(r.priority >= p, `priority ${r.priority} >= ${p}`)
    }
    const p5 = await logs(a, '?limit=1000&priority=5')
    const p7 = await logs(a, '?limit=1000&priority=7')
    assert.ok(p5.length >= p7.length)
    if (p5.some(r => r.priority > 5)) assert.ok(p5.some(r => r.priority === 7) || p5.some(r => r.priority === 6))
  })
})

test('backend 3.4: serial filter is an equality match', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, `?limit=1000&serial=${SERIAL}`)
    assert.ok(rows.length > 0)
    for (const r of rows) assert.equal(r.serial, SERIAL)
    assert.deepEqual(await logs(a, '?serial=emulator-nope'), [])
    assert.deepEqual(await logs(a, `?serial=${SERIAL.slice(0, -1)}`), [])
  })
})

test('backend 3.4 (intended difference): q is a case-insensitive substring over message, tag and identifier (new: and serial)', async () => {
  await withUsers(1, async a => {
    const lower = await logs(a, '?limit=1000&q=device:lifecycle')
    assert.ok(lower.length > 0)
    for (const r of lower) assert.ok(text(r).includes('device:lifecycle'))
    const upper = await logs(a, '?limit=1000&q=DEVICE:LIFECYCLE')
    assert.deepEqual(upper.map(r => r.id), lower.map(r => r.id))
    const msg = await logs(a, '?limit=1000&q=became%20present')
    assert.ok(msg.length > 0)
    for (const r of msg) assert.match(r.message, /became present/i)
    const ident = await logs(a, `?limit=1000&q=${SERIAL}`)
    assert.ok(ident.length > 0)
    for (const r of ident) assert.ok(text(r).includes(SERIAL))
  })
})

test('backend 3.4: q is literal, regex metacharacters are escaped', async () => {
  await withUsers(1, async a => {
    for (const q of ['.*', 'a.c', '(', '[', '^become', '\\']) {
      const res = await a.get('/health/logs?limit=1000&q=' + encodeURIComponent(q))
      assert.equal(res.status, 200, q)
      for (const r of res.json.logs) assert.ok(text(r).includes(q.toLowerCase()), `row matches literal ${q}`)
    }
  })
})

test('backend 3.4 (intended difference): q does not match kind (old: nor serial; new: serial matches)', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    const kinds = new Set(rows.map(r => r.kind))
    for (const kind of kinds) {
      const hits = await logs(a, `?limit=1000&q=${encodeURIComponent(kind)}`)
      for (const r of hits) assert.ok(text(r).includes(kind.toLowerCase()), `${kind} only matches via message/tag/identifier`)
    }
  })
})

test('backend 3.4 / B3.4: empty q is no filter', async () => {
  await withUsers(1, async a => {
    const a1 = await logs(a, '?limit=5')
    const a2 = await logs(a, '?limit=5&q=')
    assert.equal(a2.length, a1.length)
  })
})

test('backend 3.14 / B3.12: swagger rejects out-of-range or non-integer priority and limit with 400', async () => {
  await withUsers(1, async a => {
    for (const q of ['priority=0', 'priority=8', 'priority=abc', 'priority=1.5', 'limit=0', 'limit=1001', 'limit=abc', 'limit=1.5']) {
      const res = await a.get('/health/logs?' + q)
      assert.equal(res.status, 400, q)
      assert.equal(res.json.message, 'Validation errors', q)
    }
    for (const q of ['priority=1', 'priority=7', 'limit=1', 'limit=1000']) {
      assert.equal((await a.get('/health/logs?' + q)).status, 200, q)
    }
  })
})

test('backend 3.15 / B3.2: REST rows have exactly the documented fields and types', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    assert.ok(rows.length > 0)
    for (const r of rows) {
      assert.deepEqual(Object.keys(r).sort(), ROW_KEYS)
      assert.equal(r.health, true)
      assert.equal(typeof r.id, 'string')
      assert.equal(typeof r.priority, 'number')
      assert.equal(typeof r.pid, 'number')
      assert.equal(typeof r.tag, 'string')
      assert.equal(typeof r.message, 'string')
      assert.equal(typeof r.identifier, 'string')
      assert.ok(r.serial === null || typeof r.serial === 'string')
      assert.equal(typeof r.kind, 'string')
      assert.match(r.timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    }
  })
})

test('backend 3.15: severity and levelLabel follow the priority', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    for (const r of rows) {
      const name = LEVELS[r.priority]
      if (!name) continue
      assert.equal(r.severity, name)
      assert.equal(r.levelLabel, name[0].toUpperCase() + name.slice(1))
    }
    assert.ok(rows.some(r => LEVELS[r.priority]))
  })
})

test('backend 3.15 / B3.3: messageSummary is the first line, details the remaining lines joined with \\n', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    for (const r of rows) {
      const lines = r.message.split(/\r?\n/)
      assert.equal(r.messageSummary, lines[0])
      assert.equal(r.details, lines.slice(1).join('\n'))
    }
  })
})

test('backend 3.8 / 3.9 (intended difference): device use and release publish kind=device rows with serial', async () => {
  await withUsers(1, async a => {
    const tag = 'device:plugins:group'
    assert.equal((await a.use()).status, 200)
    const owned = await waitLogs(a, `?limit=50&serial=${SERIAL}&q=${encodeURIComponent(a.email)}`
    , rows => rows.some(r => /^Now owned by/.test(r.message)))
    const row = owned.find(r => /^Now owned by/.test(r.message))
    assert.ok(row, 'Now owned by row')
    assert.equal(row.kind, 'device')
    assert.equal(row.serial, SERIAL)
    assert.equal(row.tag, tag)
    assert.equal(row.priority, isNew ? 3 : 4)
    assert.equal(row.severity, isNew ? 'info' : 'important')
    assert.ok(row.message.includes(a.email))
    assert.equal((await a.stop()).status, 200)
    const freed = await waitLogs(a, `?limit=50&serial=${SERIAL}&q=${encodeURIComponent(a.email)}`
    , rows => rows.some(r => /^No longer owned by/.test(r.message)))
    const gone = freed.find(r => /^No longer owned by/.test(r.message))
    assert.ok(gone, 'No longer owned by row')
    assert.equal(gone.kind, 'device')
    assert.equal(gone.tag, tag)
    assert.equal(gone.priority, isNew ? 3 : 4)
    assert.match(gone.message, /\(reason: ungroup_request\)$/)
  })
})

test('backend 3.16 / B3.2 (intended difference): admin sockets receive health.log with the presented shape minus id and health', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    const seen = []
    socket.on('health.log', m => seen.push(m))
    const first = once(socket, 'health.log', 8000)
    assert.equal((await a.use()).status, 200)
    await first
    await sleep(500)
    await a.stop()
    await sleep(1000)
    assert.ok(seen.length > 0)
    const mine = seen.find(m => m.serial === SERIAL && /^Now owned by/.test(m.message) && m.message.includes(a.email))
    assert.ok(mine, 'received the Now owned by entry')
    for (const m of seen) {
      for (const k of SOCKET_KEYS) {
        if (k === 'serial') continue
        assert.ok(k in m, `field ${k}`)
      }
      assert.ok(!('id' in m))
      assert.ok(!('health' in m))
      assert.equal(typeof m.priority, 'number')
      assert.ok(m.serial === undefined || m.serial === null || typeof m.serial === 'string')
    }
    assert.equal(mine.kind, 'device')
    assert.equal(mine.severity, isNew ? 'info' : 'important')
    assert.equal(mine.levelLabel, isNew ? 'Info' : 'Important')
    assert.ok(Math.abs(Date.parse(mine.timestamp) - Date.now()) < 60000, 'timestamp is a real date from seconds')
  })
})

test('backend 3.16 (intended difference): generic logger entries below IMPORTANT never appear (old: every row has priority >= 4; new: routine events are classified INFO, nothing is below 3)', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    const min = isNew ? 3 : 4
    for (const r of rows) assert.ok(r.priority >= min, `priority ${r.priority}`)
  })
})

test('backend 3.8 / 3.10: a socket-connected session sees the same ids in REST afterwards', async () => {
  await withUsers(1, async a => {
    const socket = await a.socket()
    const seen = []
    socket.on('health.log', m => seen.push(m))
    await a.use()
    await sleep(1500)
    await a.stop()
    await sleep(1000)
    const rest = await waitLogs(a, `?limit=200&serial=${SERIAL}&q=${encodeURIComponent(a.email)}`, r => r.length >= 2)
    for (const m of seen.filter(m => m.serial === SERIAL && m.message.includes(a.email))) {
      assert.ok(rest.some(r => r.message === m.message && r.tag === m.tag), `row for "${m.message}" persisted`)
    }
  })
})

test('backend 3.11 / B3.9 (intended difference): processor lifecycle rows exist with the documented tags, messages and kind', async () => {
  await withUsers(1, async a => {
    const expect = {
      'device:lifecycle:present': 'Device became present'
    , 'device:lifecycle:ready': 'Device worker is ready'
    }
    for (const [tag, message] of Object.entries(expect)) {
      const rows = await logs(a, `?limit=1000&serial=${SERIAL}&q=${tag}`)
      assert.ok(rows.length > 0, tag)
      const tagged = rows.filter(r => r.tag === tag)
      assert.equal(tagged[0].priority, isNew ? 3 : 4)
      for (const r of tagged) {
        assert.equal(r.kind, 'processor')
        assert.equal(r.message, message)
        assert.equal(r.serial, SERIAL)
      }
    }
  })
})

test('backend 3.12 / B3.8 (intended difference): provider connection rows: found and registered', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, `?limit=1000&serial=${SERIAL}&q=device:connection`)
    const byTag = tag => rows.filter(r => r.tag === tag)
    const found = byTag('device:connection:found')
    assert.ok(found.length > 0, 'found')
    assert.equal(found[0].priority, isNew ? 3 : 4)
    for (const r of found) {
      assert.equal(r.kind, 'provider')
      assert.match(r.message, new RegExp(`^Found device "${SERIAL}" \\([a-z]+\\)$`))
    }
    const reg = byTag('device:connection:registered')
    assert.ok(reg.length > 0, 'registered')
    for (const r of reg) {
      assert.equal(r.kind, 'provider')
      assert.equal(r.message, 'Device registration acknowledged')
    }
  })
})

test('backend 7.1 / B3.6: connection status rows name the status from the ADB type (only on state changes, vacuous otherwise)', async t => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000&q=device:connection:status')
    if (!rows.length) t.diagnostic('no status-change rows in the last 24h; cannot trigger one on a shared emulator')
    for (const r of rows) {
      assert.equal(r.kind, 'provider')
    }
    for (const r of rows) {
      const m = /^Connection status changed to ([A-Z]+) \(ADB type "([a-z]+)"\)$/.exec(r.message)
      assert.ok(m, r.message)
      const map = {device: 'ONLINE', emulator: 'ONLINE', unauthorized: 'UNAUTHORIZED', offline: 'OFFLINE', connecting: 'CONNECTING', authorizing: 'AUTHORIZING'}
      assert.equal(m[1], map[m[2]] || 'UNKNOWN')
    }
  })
})

test('backend 3.12 / B3.7: worker-exit rows are ERROR with exit code, worker-restart rows are WARNING', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000&q=device:connection:worker')
    for (const r of rows) {
      assert.equal(r.kind, 'provider')
      if (r.tag === 'device:connection:worker-exit') {
        assert.equal(r.priority, 6)
        assert.match(r.message, /^Device worker exited with code \d+$/)
      }
      else if (r.tag === 'device:connection:worker-restart') {
        assert.equal(r.priority, 5)
        assert.match(r.message, /^Restarting device worker after exit code \d+$/)
      }
      else if (r.tag === 'device:connection:worker-error') {
        assert.equal(r.priority, 6)
        assert.match(r.message, /^Device worker error: /)
      }
      else assert.fail(`unexpected tag ${r.tag}`)
    }
  })
})

test('backend 3.8 / B3.11: server rows (kind server) carry serial null; device rows carry a serial', async () => {
  await withUsers(1, async a => {
    const rows = await logs(a, '?limit=1000')
    for (const r of rows.filter(r => r.kind === 'device')) assert.equal(typeof r.serial, 'string')
    for (const r of rows.filter(r => r.kind === 'server')) assert.equal(r.serial, null)
  })
})

test('backend 3.8: an admin ADB-key style IMPORTANT server log lands in the health table', async () => {
  await withUsers(1, async a => {
    const name = 'parity-health-' + Math.random().toString(36).slice(2, 8)
    const probe = await a.get('/adbkeys')
    assert.equal(probe.status, 200)
    if (!probe.json.configured) return
    const {generateKeyPairSync} = await import('node:crypto')
    const pem = generateKeyPairSync('rsa', {modulusLength: 2048, publicExponent: 65537})
      .privateKey.export({type: 'pkcs1', format: 'pem'})
    const add = await a.api('POST', '/adbkeys', {name, key: pem})
    try {
      assert.equal(add.status, 201, add.text)
      const rows = await waitLogs(a, `?limit=100&q=${name}`, r => r.length > 0)
      const row = rows.find(r => r.message.includes(`added ADB key "${name}.adb_key"`))
      assert.ok(row, 'added ADB key row')
      assert.equal(row.priority, 4)
      assert.equal(row.kind, 'server')
      assert.ok(row.message.includes(a.email))
      assert.ok(!row.message.includes('PRIVATE KEY'))
    }
    finally {
      if (add.status === 201) await a.api('DELETE', `/adbkeys/${add.json.key.name}`)
    }
  })
})

test('backend 3.4 (intended difference): q also matches the device serial; old has no such match', async () => {
  await withUsers(1, async a => {
    const hits = await logs(a, `?limit=1000&q=${encodeURIComponent(SERIAL.toUpperCase())}`)
    if (isNew) assert.ok(hits.some(r => r.serial === SERIAL))
    for (const r of hits) assert.ok(text(r).includes(SERIAL.toLowerCase()))
  })
})
