import {test, before, after} from 'node:test'
import assert from 'node:assert/strict'
import {SERIAL, BASE, raw, withUsers, lockDevice, unlockDevice} from '../harness.mjs'
import {runCli, withToken, shellAll} from '../cli.mjs'

before(lockDevice)
after(unlockDevice)

const shell = (token, body) => raw(null, 'POST', '/api/v1/devices/shell', {auth: token, body})
const own = (res, serial = SERIAL) => res.json.results.find(r => r.serial === serial)

test('backend 4.11: POST /devices/shell requires authentication', async () => {
  const res = await raw(null, 'POST', '/api/v1/devices/shell', {body: {command: 'true'}})
  assert.equal(res.status, 401)
  assert.deepEqual(res.json, {success: false, description: 'Requires Authentication'})
})

test('backend 4.11 / B0.1: a user-privilege token gets 403 (vacuous while everyone is admin)', async t => {
  await withUsers(1, async a => {
    if (a.user.privilege === 'admin') return t.diagnostic('everyone is admin; no 403 case possible')
    await withToken(a, async token => {
      const res = await shell(token, {command: 'true'})
      assert.equal(res.status, 403)
    })
  })
})

test('backend 4.8: runs on the ready device and reports Shell command completed with the exact result shape', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const res = await shell(token, {command: 'echo hi'})
      assert.equal(res.status, 200)
      assert.equal(res.json.success, true)
      assert.equal(res.json.description, 'Shell command completed')
      assert.deepEqual(res.json.skipped, [])
      assert.deepEqual(own(res), {serial: SERIAL, success: true, data: 'hi\n'})
    })
  })
})

test('backend 4.8: the session cookie works too (accessTokenAuth accepts both)', async () => {
  await withUsers(1, async a => {
    const res = await a.api('POST', '/devices/shell', {command: 'echo cookie'})
    assert.equal(res.status, 200)
    assert.equal(own(res).data, 'cookie\n')
  })
})

test('backend 4.6: output is the concatenation of the device output chunks', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const res = await shell(token, {command: 'echo a; echo b; echo c'})
      assert.equal(own(res).data, 'a\nb\nc\n')
      const sdk = await shell(token, {command: 'getprop ro.build.version.sdk'})
      assert.match(own(sdk).data, /^\d+\n$/)
      const empty = await shell(token, {command: 'true'})
      assert.deepEqual(own(empty), {serial: SERIAL, success: true, data: ''})
    })
  })
})

test('backend 4.1: empty or missing command is rejected', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const empty = await shell(token, {command: ''})
      assert.equal(empty.status, 400)
      assert.deepEqual(empty.json, {success: false, description: 'Bad Request: missing command'})
      const missing = await shell(token, {})
      assert.equal(missing.status, 400)
      assert.equal(missing.json.message, 'Validation errors')
      assert.equal(missing.json.errors[0].errors[0].code, 'OBJECT_MISSING_REQUIRED_PROPERTY')
    })
  })
})

test('backend 4.1: timeout must be an integer in 1..60000, force a boolean, command a string (swagger 400)', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      for (const body of [
        {command: 'true', timeout: 0}
      , {command: 'true', timeout: 60001}
      , {command: 'true', timeout: 1.5}
      , {command: 'true', timeout: '5'}
      , {command: 'true', force: 'yes'}
      , {command: 5}
      ]) {
        const res = await shell(token, body)
        assert.equal(res.status, 400, JSON.stringify(body))
        assert.equal(res.json.message, 'Validation errors', JSON.stringify(body))
      }
      for (const timeout of [1, 60000]) {
        const res = await shell(token, {command: 'true', timeout})
        assert.equal(res.status, 200, `timeout ${timeout}`)
      }
    })
  })
})

test('backend 4.3: a device with an owner is skipped without force', async () => {
  await withUsers(2, async (a, b) => {
    assert.equal((await a.use()).status, 200)
    await withToken(b, async token => {
      const res = await shell(token, {command: 'echo hi'})
      assert.equal(res.status, 200)
      assert.deepEqual(res.json.skipped, [{serial: SERIAL, reason: `in use by ${a.user.name}`}])
      assert.equal(own(res), undefined)
    })
  })
})

test('backend 4.4: with nothing eligible the answer is 200 No eligible devices with empty results', async () => {
  await withUsers(2, async (a, b) => {
    await a.use()
    await withToken(b, async token => {
      const res = await shell(token, {command: 'echo hi', force: false})
      assert.equal(res.status, 200)
      assert.equal(res.json.success, true)
      assert.equal(res.json.description, 'No eligible devices')
      assert.deepEqual(res.json.results, [])
      assert.equal(res.json.skipped.length >= 1, true)
    })
  })
})

test('backend 4.3 / B4.1: the caller own device is skipped too without force', async () => {
  await withUsers(1, async a => {
    await a.use()
    await withToken(a, async token => {
      const res = await shell(token, {command: 'echo hi'})
      assert.deepEqual(res.json.skipped, [{serial: SERIAL, reason: `in use by ${a.user.name}`}])
      assert.equal(res.json.description, 'No eligible devices')
    })
  })
})

test('backend 4.3: force runs on devices that have an owner', async () => {
  await withUsers(2, async (a, b) => {
    await a.use()
    await withToken(b, async token => {
      const res = await shell(token, {command: 'echo forced', force: true})
      assert.equal(res.status, 200)
      assert.equal(res.json.description, 'Shell command completed')
      assert.deepEqual(res.json.skipped, [])
      assert.equal(own(res).data, 'forced\n')
      assert.equal(own(res).success, true)
    })
  })
})

test('backend 4.9: the command is killed at timeout on the device; the response comes back early with success true', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const start = Date.now()
      const res = await shell(token, {command: 'sleep 4; echo late', timeout: 1000})
      const took = Date.now() - start
      assert.equal(res.status, 200)
      assert.equal(res.json.description, 'Shell command completed')
      assert.equal(own(res).success, true)
      assert.equal(own(res).data, '')
      assert.ok(took >= 900 && took < 3500, `took ${took}`)
    })
  })
})

test('backend B4.3: a command of only spaces passes the controller and runs', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const res = await shell(token, {command: '   '})
      assert.equal(res.status, 200)
      assert.deepEqual(own(res), {serial: SERIAL, success: true, data: ''})
    })
  })
})

test('backend B4.3: the command goes to the device verbatim (quotes, pipes, long input)', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const res = await shell(token, {command: `echo "a b" | cat; echo '$HOME' x`})
      assert.equal(own(res).data, 'a b\n$HOME x\n')
      const long = 'x'.repeat(3000)
      const big = await shell(token, {command: `echo ${long}`})
      assert.equal(own(big).data, long + '\n')
    })
  })
})

test('backend 4.8: results are scoped to the present and ready devices only (every result serial is a ready device)', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const res = await shell(token, {command: 'true'})
      const devs = (await a.get('/devices?fields=serial,present,ready')).json.devices
      for (const r of res.json.results) {
        const d = devs.find(d => d.serial === r.serial)
        assert.ok(d && d.present && d.ready, r.serial)
      }
    })
  })
})

test('backend 4.12: stf shell-all runs the command and prints "== serial [ok]" then data, summary on stderr, exit 0', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const out = await shellAll(token, ['echo', 'hi'])
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.stdout.includes(`== ${SERIAL} [ok]\nhi\n`), out.stdout)
      assert.match(out.stderr, /^Shell command completed: \d+ ran, 0 failed, 0 skipped\n$/)
    })
  })
})

test('backend 4.12: command arguments are joined with a space', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const out = await shellAll(token, ['echo', 'a', 'b', 'c'])
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.stdout.includes('a b c\n'), out.stdout)
    })
  })
})

test('backend 4.12: empty output prints only the header; data without trailing newline gets one', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const none = await shellAll(token, ['true'])
      assert.ok(none.stdout.includes(`== ${SERIAL} [ok]\n`))
      assert.ok(!none.stdout.includes('\n\n'))
      const nonl = await shellAll(token, ['printf', 'abc'])
      assert.ok(nonl.stdout.includes(`== ${SERIAL} [ok]\nabc\n`), JSON.stringify(nonl.stdout))
    })
  })
})

test('backend 4.12 / B4.5: skipped devices print "== serial [skipped: reason]" and the summary counts them; exit 0', async () => {
  await withUsers(1, async a => {
    await a.use()
    await withToken(a, async token => {
      const out = await shellAll(token, ['echo', 'hi'])
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.stdout.includes(`== ${SERIAL} [skipped: in use by ${a.user.name}]\n`), out.stdout)
      assert.match(out.stderr, /^No eligible devices: 0 ran, 0 failed, 1 skipped\n$/)
    })
  })
})

test('backend 4.12: --force / -f runs on devices in use', async () => {
  await withUsers(1, async a => {
    await a.use()
    await withToken(a, async token => {
      for (const flag of ['--force', '-f']) {
        const out = await shellAll(token, [flag, 'echo', 'forced'])
        assert.equal(out.code, 0, out.stderr)
        assert.ok(out.stdout.includes(`== ${SERIAL} [ok]\nforced\n`), `${flag}: ${out.stdout}`)
        assert.match(out.stderr, /^Shell command completed: \d+ ran, 0 failed, 0 skipped\n$/)
      }
    })
  })
})

test('backend 4.12: --timeout is passed to the server', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const start = Date.now()
      const out = await shellAll(token, ['--timeout', '1000', 'sleep 4; echo late'])
      assert.equal(out.code, 0, out.stderr)
      assert.ok(!out.stdout.includes('late'))
      assert.ok(Date.now() - start < 3800)
    })
  })
})

test('backend 4.12 / B4.6: --timeout out of range comes back as HTTP 400 and exits 1', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      for (const t of ['0', '60001', '-5']) {
        const out = await shellAll(token, ['--timeout', t, 'true'])
        assert.equal(out.code, 1, `timeout ${t}`)
        assert.equal(out.stdout, '')
        assert.equal(out.stderr, 'shell-all failed: 400: Validation errors\n', `timeout ${t}`)
      }
    })
  })
})

test('backend 4.12: a bad token exits 1 with "shell-all failed: 401: Bad Credentials"', async () => {
  const out = await shellAll('not-a-token', ['true'])
  assert.equal(out.code, 1)
  assert.equal(out.stderr, 'shell-all failed: 401: Bad Credentials\n')
})

test('backend 4.12: an unreachable server exits 1 with "shell-all failed:"', async () => {
  const out = await runCli(['shell-all', '--url', 'http://127.0.0.1:1', '--token', 'x', 'true'])
  assert.equal(out.code, 1)
  assert.match(out.stderr, /^shell-all failed: /)
})

test('backend 4.12: --token is required', async () => {
  const out = await runCli(['shell-all', '--url', BASE, 'true'])
  assert.notEqual(out.code, 0)
  assert.match(out.stderr, /Missing required argument: token/)
})

test('backend 4.12: --url accepts a trailing slash', async () => {
  await withUsers(1, async a => {
    await withToken(a, async token => {
      const out = await runCli(['shell-all', '--url', BASE + '/', '-t', token, 'echo', 'slash'])
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.stdout.includes('slash\n'))
    })
  })
})

test('backend 4.12 / B4.7: STF_SHELL_ALL_* environment variables supply token, url, force and timeout', async () => {
  await withUsers(1, async a => {
    await a.use()
    await withToken(a, async token => {
      const out = await runCli(['shell-all', 'echo', 'env'], {
        env: {STF_SHELL_ALL_TOKEN: token, STF_SHELL_ALL_URL: BASE, STF_SHELL_ALL_FORCE: 'true'}
      })
      assert.equal(out.code, 0, out.stderr)
      assert.ok(out.stdout.includes(`== ${SERIAL} [ok]\nenv\n`), out.stdout)
      const slow = await runCli(['shell-all', 'sleep 4; echo late'], {
        env: {STF_SHELL_ALL_TOKEN: token, STF_SHELL_ALL_URL: BASE, STF_SHELL_ALL_FORCE: 'true', STF_SHELL_ALL_TIMEOUT: '0'}
      })
      assert.equal(slow.code, 1)
      assert.equal(slow.stderr, 'shell-all failed: 400: Validation errors\n')
    })
  })
})

test('backend 4.12: unknown options are rejected (strict)', async () => {
  const out = await runCli(['shell-all', '--url', BASE, '-t', 'x', 'true', '--bogus'])
  assert.notEqual(out.code, 0)
  assert.match(out.stderr, /Unknown argument: bogus/)
})
