import fs from 'node:fs'
import {test, expect} from './pw.mjs'
import {ui, SERIAL} from './ui-map.mjs'
import {uniq, loginGuest, gotoSettings, api} from './support.mjs'
import {login, releaseAll} from '../harness.mjs'

const sh = ui.shellAll

async function open(page) {
  const name = await loginGuest(page)
  await gotoSettings(page, 'Devices')
  await expect(sh.input(page)).toBeVisible()
  return name
}

const mockShell = (page, body, status = 200) =>
  page.route('**/api/v1/devices/shell', r => r.fulfill({status, json: body}))

test.describe('5 Settings > Devices: shell on all devices', () => {
  test('5.1/5.2 form: placeholder, checkbox, Run disabled until a command is typed', async ({page}) => {
    await open(page)
    await expect(page.getByText('Run a shell command on all devices').first()).toBeVisible()
    await expect(sh.force(page)).not.toBeChecked()
    await expect(sh.run(page)).toBeDisabled()
    await sh.input(page).fill('echo x')
    await expect(sh.run(page)).toBeEnabled()
    await sh.input(page).fill('')
    await expect(sh.run(page)).toBeDisabled()
  })

  test('5.2 Enter with an empty command does not send a request', async ({page}) => {
    await open(page)
    let sent = 0
    await page.route('**/api/v1/devices/shell', r => { sent++; return r.abort() })
    await sh.input(page).press('Enter')
    await page.waitForTimeout(800)
    expect(sent).toBe(0)
  })

  test('5.3-5.6 run echo: body is {command, force} only, result shows serial, ok, output; fields kept', async ({page}) => {
    await open(page)
    const marker = uniq('parity')
    await sh.input(page).fill(`echo ${marker}`)
    const request = page.waitForRequest(r => r.url().endsWith('/api/v1/devices/shell') && r.method() === 'POST')
    await sh.run(page).click()
    expect((await request).postDataJSON()).toEqual({command: `echo ${marker}`, force: false})
    const result = sh.result(page).filter({hasText: SERIAL})
    await expect(result).toBeVisible({timeout: 30000})
    await expect(result).toContainText('ok')
    await expect(result.locator('pre')).toHaveText(marker)
    await expect(sh.input(page)).toHaveValue(`echo ${marker}`)
    await expect(sh.exportCsv(page)).toBeVisible()
  })

  test('5.10 no confirm dialog on Run, even with "Include devices in use"', async ({page}) => {
    await open(page)
    await mockShell(page, {success: true, description: 'Ran', results: [], skipped: []})
    await sh.force(page).check()
    await sh.input(page).fill('echo hi')
    const request = page.waitForRequest(r => r.url().endsWith('/api/v1/devices/shell'))
    expect(await ui.noConfirm(page, () => sh.run(page).click())).toBe(true)
    expect((await request).postDataJSON()).toEqual({command: 'echo hi', force: true})
  })

  test('5.5 HTTP error shows description, or "Request failed"; no results, no export', async ({page}) => {
    await open(page)
    await mockShell(page, {success: false, description: 'Boom from server'}, 500)
    await sh.input(page).fill('echo hi')
    await sh.run(page).click()
    await expect(sh.results(page)).toContainText('Boom from server')
    await expect(sh.exportCsv(page)).toBeHidden()
    await page.unroute('**/api/v1/devices/shell')
    await mockShell(page, {success: false}, 500)
    await sh.run(page).click()
    await expect(sh.results(page)).toContainText('Request failed')
  })

  test('5.6/5.7 statuses ok / failed / timed out and skipped reason', async ({page}) => {
    await open(page)
    await mockShell(page, {
      success: true
    , description: 'Mock description line'
    , results: [
        {serial: 'ser-ok', success: true, data: 'fine'}
      , {serial: 'ser-fail', success: false, error: 'it broke'}
      , {serial: 'ser-slow', success: null, error: 'too slow'}
      ]
    , skipped: [{serial: 'ser-skip', reason: 'in use by someone'}]
    })
    await sh.input(page).fill('echo hi')
    await sh.run(page).click()
    await expect(sh.results(page)).toContainText('Mock description line')
    const row = s => sh.result(page).filter({hasText: s})
    await expect(row('ser-ok')).toContainText('ok')
    await expect(row('ser-ok').locator('pre')).toHaveText('fine')
    await expect(row('ser-fail')).toContainText('failed')
    await expect(row('ser-fail').locator('pre')).toHaveText('it broke')
    await expect(row('ser-slow')).toContainText('timed out')
    await expect(row('ser-slow').locator('pre')).toHaveText('too slow')
    await expect(row('ser-skip')).toContainText('skipped: in use by someone')
    await expect(row('ser-skip').locator('pre')).toHaveCount(0)
  })

  test('5.4 a new run clears the previous results first', async ({page}) => {
    await open(page)
    let release
    const gate = new Promise(r => { release = r })
    let calls = 0
    await page.route('**/api/v1/devices/shell', async r => {
      calls++
      if (calls === 2) await gate
      await r.fulfill({json: {success: true, description: `run ${calls}`, results: [{serial: 's', success: true, data: 'd'}], skipped: []}})
    })
    await sh.input(page).fill('echo hi')
    await sh.run(page).click()
    await expect(sh.results(page)).toContainText('run 1')
    await sh.run(page).click()
    await expect(sh.results(page)).toBeHidden()
    release()
    await expect(sh.results(page)).toContainText('run 2')
  })

  test('5.8 Export CSV: file name, quoting, CRLF, no trailing newline, columns command,serial,status,output', async ({page}) => {
    await open(page)
    await mockShell(page, {
      success: true
    , description: 'd'
    , results: [
        {serial: 'a1', success: true, data: 'say "hi"\nline2'}
      , {serial: 'b2', success: false, error: 'bad'}
      , {serial: 'c3', success: null, error: 'slow'}
      ]
    , skipped: [{serial: 'd4', reason: 'in use by x'}]
    })
    await sh.input(page).fill('echo "q"')
    await sh.run(page).click()
    await expect(sh.exportCsv(page)).toBeVisible()
    // editing the command afterwards must not change the exported command
    await sh.input(page).fill('something else')
    const [download] = await Promise.all([page.waitForEvent('download'), sh.exportCsv(page).click()])
    expect(download.suggestedFilename()).toMatch(/^shell-all-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.csv$/)
    const text = fs.readFileSync(await download.path(), 'utf8')
    expect(text).toBe([
      '"command","serial","status","output"'
    , '"echo ""q""","a1","ok","say ""hi""\nline2"'
    , '"echo ""q""","b2","failed","bad"'
    , '"echo ""q""","c3","timed out","slow"'
    , '"echo ""q""","d4","skipped","in use by x"'
    ].join('\r\n'))
  })

  test('5.7 skipped: a device held by another user is skipped without force, run with force', async ({page}) => {
    await open(page)
    const other = await login(uniq('holder'))
    try {
      expect((await other.use()).status).toBe(200)
      await sh.input(page).fill('echo forced-run')
      await sh.run(page).click()
      const row = sh.result(page).filter({hasText: SERIAL})
      await expect(row).toBeVisible({timeout: 30000})
      await expect(row).toContainText(/skipped: in use by/)
      await expect(sh.exportCsv(page)).toBeVisible()

      await sh.force(page).check()
      await sh.run(page).click()
      await expect(sh.result(page).filter({hasText: SERIAL}).locator('pre')).toHaveText('forced-run', {timeout: 30000})
      await expect(sh.result(page).filter({hasText: SERIAL})).not.toContainText('skipped')
    }
    finally {
      await releaseAll([other])
    }
  })
})
