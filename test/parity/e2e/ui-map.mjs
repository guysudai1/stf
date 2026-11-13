// Per-UI selector and action map. Specs never hard-code a selector: they call into `ui`.
// old = AngularJS fork (specification), new = React/Mantine port.
import {expect} from './pw.mjs'

export const TARGET = process.env.PARITY_TARGET || 'old'
if (!['old', 'new'].includes(TARGET)) throw new Error('PARITY_TARGET must be old or new')
export const isNew = TARGET === 'new'
export const SERIAL = isNew ? 'emulator-5556' : 'emulator-5554'

const exactText = text => new RegExp('^\\s*' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')

// Both UIs share these (same class names are kept by the port).
const common = {
  nickname: page => page.locator('input[name="nickname"]')
, continueButton: page => page.getByRole('button', {name: 'Continue'})
, guestError: page => page.locator('.alert-danger')
, devicesReady: page => page.locator('.device-stats')
, version: page => page.locator('.version-text')
, currentUser: page => page.locator('.stf-current-user')
, logout: page => page.locator('.stf-logout')
, timeoutInput: page => page.locator('[data-testid="device-timeout-input"]')
, timeoutReset: page => page.locator('[data-testid="device-timeout-reset"]')
, saveTimeout: page => page.getByRole('button', {name: 'Save', exact: true})
, shellAll: {
    input: page => page.getByPlaceholder('e.g. getprop ro.product.model')
  , force: page => page.getByLabel('Include devices in use')
  , run: page => page.locator('.shell-all button[type=submit]')
  , results: page => page.locator('.shell-all-results')
  , result: page => page.locator('.shell-all-result')
  , exportCsv: page => page.getByRole('button', {name: 'Export CSV'})
  }
, health: {
    heading: page => page.getByText('Health & Logs', {exact: true})
  , search: page => page.getByPlaceholder('Search tag, source, or message')
  , refresh: page => page.getByRole('button', {name: /Refresh/})
  , table: page => page.locator('table').filter({has: page.getByRole('columnheader', {name: 'Source'})})
  , rows: page => page.locator('table').filter({has: page.getByRole('columnheader', {name: 'Source'})}).locator('tbody tr')
  , headers: page => page.locator('table').filter({has: page.getByRole('columnheader', {name: 'Source'})}).locator('thead th')
  }
, keys: {
    card: page => page.locator('.stf-provider-keys')
  , fileInput: page => page.locator('.stf-provider-keys input[type=file]')
  , nameInput: page => page.getByPlaceholder('Key name')
  , addButton: page => page.getByRole('button', {name: 'Add key'})
  , rows: page => page.locator('.provider-keys-table tbody tr')
  , error: page => page.locator('.provider-keys-error')
  }
, apps: {
    search: root => root.locator('input[type=search]')
  , system: root => root.getByLabel('Include system apps')
  , rows: root => root.locator('tbody tr')
  , headers: root => root.locator('thead th')
  }
}

const old = {
  ...common
, hash: '#!'
, tile: (page, serial = SERIAL) => page.locator(`ul.devices-icon-view > li[id$="-${serial}"]`)
, statusButton: tile => tile.locator('button.device-status')
, stat: (page, name) => page.locator(`.device-stats .counter[data-type="${name}"]`)
, myDevicesLabel: page => page.locator('.device-stats .text').filter({hasText: 'My Devices'})
, tooltip: page => page.locator('.tooltip')
, themeToggle: page => page.locator('[data-testid="theme-toggle"]')
, isDark: async page => (await page.locator('body').getAttribute('class') || '').includes('stf-dark-theme')
, contactSupport: page => page.getByRole('button', {name: 'Contact Support'})
, healthLink: page => page.locator('a[href="/#!/health-logs"]')
, settingsTab: (page, name) => page.locator('.nav-tabs a').filter({hasText: exactText(name)}).first()
, timeoutHelp: page => page.getByText(/reset to use the provider timeout\. This applies to newly acquired devices\./)
, timeoutError: page => page.getByText('Enter a whole number from 1 to 86400 seconds.')
, controlReady: page => page.locator('device-screen')
, stopUsing: page => page.locator('.stf-vnc-right-buttons button.btn-danger-outline')
, paneTab: (page, name) => page.locator('.nav-tabs a').filter({hasText: exactText(name)}).first()
, paneTabNames: page => page.locator('.nav-tabs').first().locator('li').allInnerTexts()
, appsRoot: page => page.locator('.stf-packages').first()
, appsBadge: root => root.locator('.heading .badge')
, appsRefresh: root => root.locator('.heading button')
, md5Button: root => root.getByRole('button', {name: 'Get MD5'})
, resizeHandle: th => th.locator('.column-resize-handle')
, sortState: async th => {
    if (await th.locator('.fa-sort-asc').count()) return 'asc'
    if (await th.locator('.fa-sort-desc').count()) return 'desc'
    return 'none'
  }
, keyRow: (page, name) => page.locator('.provider-keys-table tbody tr').filter({hasText: name})
, keyDelete: row => row.getByRole('button', {name: 'Delete'})
, levelOptions: async page => {
    const select = page.locator('.health-filters select')
    return (await select.locator('option').allInnerTexts()).map(t => t.trim())
  }
, selectLevel: (page, label) => page.locator('.health-filters select').selectOption({label})
  // Runs `trigger`, answers the confirm with accept/cancel, returns the text shown.
, confirm: async (page, trigger, accept) => {
    let message = null
    const handler = async dialog => {
      message = dialog.message()
      await (accept ? dialog.accept() : dialog.dismiss())
    }
    page.once('dialog', handler)
    await trigger()
    await expect.poll(() => message, {timeout: 10000}).not.toBeNull()
    return message
  }
, noConfirm: async (page, trigger) => {
    let seen = false
    const handler = () => { seen = true }
    page.once('dialog', async d => { handler(); await d.dismiss() })
    await trigger()
    await page.waitForTimeout(1000)
    page.removeAllListeners('dialog')
    return !seen
  }
}

const modal = page => page.locator('[role="dialog"]').filter({hasText: /\S/}).last()

const fresh = {
  ...common
, hash: '#'
, tile: (page) => page.locator('ul.devices-icon-view > li').first()
, statusButton: tile => tile.locator('button.device-status')
, stat: (page, name) => page.locator('.device-stats .number').nth({total: 0, usable: 1, busy: 2, using: 3}[name])
, myDevicesLabel: page => page.locator('.device-stats .current-user-name')
, tooltip: page => page.locator('[role="tooltip"]')
, themeToggle: page => page.locator('.stf-color-scheme')
, isDark: async page => (await page.locator('html').getAttribute('data-mantine-color-scheme')) === 'dark'
, contactSupport: page => page.getByLabel('Contact Support')
, healthLink: page => page.locator('a[href$="/health-logs"]').first()
, levelOptions: async page => {
    const box = page.getByRole('combobox', {name: 'Level'})
    await box.click()
    const texts = (await page.getByRole('option').allInnerTexts()).map(t => t.trim())
    await page.keyboard.press('Escape')
    return texts
  }
, selectLevel: async (page, label) => {
    await page.getByRole('combobox', {name: 'Level'}).click()
    await page.getByRole('option', {name: label, exact: true}).click()
  }
, settingsTab: (page, name) => page.getByRole('tab', {name: exactText(name)})
, timeoutHelp: page => page.getByText(/reset to use the provider timeout\. This applies to newly acquired devices\./)
, timeoutError: page => page.getByText('Enter a whole number from 1 to 86400 seconds.')
, controlReady: page => page.locator('canvas').first()
, stopUsing: page => page.getByRole('button', {name: /Stop Using/})
, paneTab: (page, name) => page.getByRole('tab', {name: exactText(name)})
, paneTabNames: page => page.getByRole('tab').allInnerTexts()
, appsRoot: page => page.getByRole('tabpanel').filter({hasText: 'Installed apps'})
, appsBadge: root => root.locator('[aria-label="Matching apps"]')
, appsRefresh: root => root.getByRole('button', {name: 'Refresh'})
, md5Button: root => root.getByRole('button', {name: 'Get MD5'})
, resizeHandle: th => th.locator('[data-testid^="resize-"]')
, sortState: async th => ({ascending: 'asc', descending: 'desc'}[await th.getAttribute('aria-sort')] || 'none')
, keyRow: (page, name) => page.locator('.provider-keys-table tbody tr').filter({hasText: name})
, keyDelete: row => row.getByRole('button', {name: 'Delete'})
, confirm: async (page, trigger, accept) => {
    await trigger()
    const dialog = modal(page)
    await expect(dialog).toBeVisible({timeout: 10000})
    const title = await dialog.locator('header, [class*="title"]').first().innerText()
    const body = await dialog.innerText()
    await dialog.getByRole('button', {name: accept ? 'OK' : 'Cancel'}).click()
    await expect(dialog).toBeHidden()
    return body.includes(title) ? body : title + '\n' + body
  }
, noConfirm: async (page, trigger) => {
    await trigger()
    await page.waitForTimeout(1000)
    return (await modal(page).count()) === 0
  }
}

export const ui = isNew ? fresh : old
export const route = path => `/${ui.hash}${path}`
