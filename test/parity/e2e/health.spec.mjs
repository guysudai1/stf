import {test, expect} from './pw.mjs'
import {ui, route, isNew} from './ui-map.mjs'
import {loginGuest} from './support.mjs'

const h = ui.health
const isHealth = (r, what) => new URL(r.url()).pathname === `/api/v1/health/${what}`

async function open(page) {
  await loginGuest(page)
  await page.goto(route('/health-logs'))
  await expect(h.search(page)).toBeVisible()
}

const entry = (over = {}) => ({
  id: 'e1', timestamp: '2026-01-02T03:04:05.000Z', priority: 6, tag: 'worker-exit', pid: 1
, message: 'Device worker exited\nstack line 1\nstack line 2', identifier: 'id', serial: 'ser-1'
, kind: 'device', health: true, severity: 'error', levelLabel: 'Error'
, messageSummary: 'Device worker exited', details: 'stack line 1\nstack line 2', ...over
})

const summary = {
  status: 'warning', statusDescription: 'Warning: something.'
, devices: {total: 3, present: 2}, logs: {total: 12, error: 4, fatal: 1}, levels: {}
}

const mock = (page, {logs = [], sum = summary, logsStatus = 200, sumStatus = 200} = {}) =>
  page.route('**/api/v1/health/*', r => {
    const path = new URL(r.request().url()).pathname
    if (path.endsWith('/summary')) {
      return r.fulfill({status: sumStatus, json: sumStatus === 200 ? {success: true, summary: sum} : {success: false}})
    }
    return r.fulfill({status: logsStatus, json: logsStatus === 200 ? {success: true, logs} : {success: false}})
  })

test.describe('4 Health & Logs', () => {
  test('4.2/4.3 heading and four summary cards from the real server', async ({page}) => {
    await open(page)
    await expect(h.heading(page).first()).toBeVisible()
    for (const label of ['Status', 'Devices', 'Last 24 hours', 'Errors / Fatal']) {
      await expect(page.getByText(label, {exact: true}).first()).toBeVisible({timeout: 20000})
    }
    await expect(page.getByText(/^\d+ \/ \d+ present$/)).toBeVisible()
    await expect(page.getByText(/^\d+ events$/)).toBeVisible()
    await expect(page.getByText(/^\d+ \/ \d+$/)).toBeVisible()
    await expect(page.getByText(/^(healthy|warning|degraded|critical)/i).first()).toBeVisible()
  })

  test('4.3 summary values and status description render from the API', async ({page}) => {
    await mock(page)
    await open(page)
    await expect(page.getByText('2 / 3 present')).toBeVisible()
    await expect(page.getByText('12 events')).toBeVisible()
    await expect(page.getByText('4 / 1', {exact: true})).toBeVisible()
    await expect(page.getByText(/^warning/).first()).toBeVisible()
    await expect(page.getByText('Warning: something.')).toBeVisible()
  })

  test('4.5 initial load sends no q and no priority; typing and level change reload with them', async ({page}) => {
    const first = page.waitForRequest(r => isHealth(r, 'logs'))
    await open(page)
    const initial = new URL((await first).url())
    expect(initial.searchParams.has('q')).toBe(false)
    expect(initial.searchParams.has('priority')).toBe(false)
    expect(initial.searchParams.has('limit')).toBe(false)
    const optionTexts = await ui.levelOptions(page)
    expect(optionTexts).toEqual(['All levels', 'Warning and above', 'Error and above', 'Fatal only'])
    const search = page.waitForRequest(r => isHealth(r, 'logs') && new URL(r.url()).searchParams.get('q') === 'worker x')
    await h.search(page).fill('worker x')
    await search
    const level = page.waitForRequest(r => isHealth(r, 'logs') && new URL(r.url()).searchParams.get('priority') === '6')
    await ui.selectLevel(page, 'Error and above')
    await level
    const fatal = page.waitForRequest(r => isHealth(r, 'logs') && new URL(r.url()).searchParams.get('priority') === '7')
    await ui.selectLevel(page, 'Fatal only')
    await fatal
  })

  test('4.6 Refresh reloads the summary and the logs with the current filters', async ({page}) => {
    await open(page)
    await h.search(page).fill('abc')
    await page.waitForTimeout(800)
    const logs = page.waitForRequest(r => isHealth(r, 'logs') && new URL(r.url()).searchParams.get('q') === 'abc')
    const sum = page.waitForRequest(r => isHealth(r, 'summary'))
    await h.refresh(page).click()
    await Promise.all([logs, sum])
  })

  test('4.7 empty state text and failure messages', async ({page}) => {
    await mock(page, {logs: []})
    await open(page)
    await expect(page.getByText('No health events in the last 24 hours.')).toBeVisible()
    await page.unroute('**/api/v1/health/*')
    await mock(page, {logsStatus: 500})
    await h.refresh(page).click()
    await expect(page.getByText('Unable to load health logs.')).toBeVisible()
    await page.unroute('**/api/v1/health/*')
    await mock(page, {sumStatus: 500})
    await h.refresh(page).click()
    await expect(page.getByText('Unable to load the health summary.')).toBeVisible()
  })

  test('4.6a (intended fix) empty result under an active filter: old repeats the 24h message, new says no matching', async ({page}) => {
    await mock(page, {logs: []})
    await open(page)
    await h.search(page).fill('zzz-nothing')
    if (isNew) {
      await expect(page.getByText(/no matching/i)).toBeVisible()
      await expect(page.getByText('No health events in the last 24 hours.')).toBeHidden()
    }
    else {
      await expect(page.getByText('No health events in the last 24 hours.')).toBeVisible()
      await expect(page.getByText(/no matching/i)).toBeHidden()
    }
  })

  test('4.11 no pagination or sort controls; server order is kept', async ({page}) => {
    await mock(page, {logs: [entry({id: 'a', tag: 'tag-a'}), entry({id: 'b', tag: 'tag-b'})]})
    await open(page)
    await expect(h.rows(page)).toHaveCount(2)
    await expect(h.rows(page).nth(0)).toContainText('tag-a')
    await expect(h.rows(page).nth(1)).toContainText('tag-b')
    await h.headers(page).filter({hasText: 'Time'}).click()
    await expect(h.rows(page).nth(0)).toContainText('tag-a')
    await expect(page.getByRole('button', {name: /load more/i})).toHaveCount(0)
  })
})

test.describe('4.8 table rendering', () => {
  test.use({timezoneId: 'UTC'})

  test('columns Time, Level, Source, Device, Message; local time; badge; serial or "-"; details expander', async ({page}) => {
    await mock(page, {logs: [
      entry()
    , entry({id: 'e2', serial: null, tag: 'plain', priority: 5, severity: 'warning', levelLabel: 'Warning'
      , message: 'one line', messageSummary: 'one line', details: ''})
    ]})
    await open(page)
    const headers = (await h.headers(page).allInnerTexts()).map(t => t.trim())
    expect(headers).toEqual(['Time', 'Level', 'Source', 'Device', 'Message'])
    const rows = h.rows(page)
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('2026-01-02 03:04:05')
    await expect(rows.nth(0)).toContainText('Error')
    await expect(rows.nth(0)).toContainText('worker-exit')
    await expect(rows.nth(0)).toContainText('ser-1')
    await expect(rows.nth(0)).toContainText('Device worker exited')
    await expect(rows.nth(0).getByText('Stack/details')).toBeVisible()
    await expect(rows.nth(0).locator('pre')).toBeHidden()
    await rows.nth(0).getByText('Stack/details').click()
    await expect(rows.nth(0).locator('pre')).toContainText('stack line 1')
    await expect(rows.nth(1)).toContainText('Warning')
    await expect(rows.nth(1)).toContainText('one line')
    await expect(rows.nth(1).getByText('Stack/details')).toHaveCount(0)
    expect((await rows.nth(1).locator('td').nth(3).innerText()).trim()).toBe('-')
  })
})
