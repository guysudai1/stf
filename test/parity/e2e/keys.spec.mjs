import {generateKeyPairSync} from 'node:crypto'
import {test, expect} from './pw.mjs'
import {ui} from './ui-map.mjs'
import {uniq, loginGuest, gotoSettings, api} from './support.mjs'

const pem = () => generateKeyPairSync('rsa', {modulusLength: 2048})
  .privateKey.export({type: 'pkcs1', format: 'pem'})

const keyFile = (name, content = pem()) => ({name, mimeType: 'text/plain', buffer: Buffer.from(content)})
const listed = async page => (await api(page, 'GET', '/api/v1/adbkeys')).json.keys.map(k => k.name)

async function open(page) {
  await loginGuest(page)
  await gotoSettings(page, 'Keys')
  await expect(ui.keys.card(page)).toBeVisible()
}

async function removeIfPresent(page, file) {
  if ((await listed(page)).includes(file)) {
    await api(page, 'DELETE', `/api/v1/adbkeys/${encodeURIComponent(file)}`)
  }
}

test.describe('9 Provider ADB keys (Settings > Keys)', () => {
  test('9.1/9.3/9.4 admin sees the card with info text, file chooser, name field, Add key disabled', async ({page}) => {
    await open(page)
    const card = ui.keys.card(page)
    await expect(card).toContainText('Provider ADB Keys')
    await expect(card).toContainText('Private keys adb offers to devices that already trust another machine.')
    await expect(page.getByText('Choose key file')).toBeVisible()
    await expect(ui.keys.nameInput(page)).toHaveAttribute('maxlength', '64')
    await expect(ui.keys.addButton(page)).toBeDisabled()
  })

  test('9.2 not configured: only the hint is shown, no form and no table', async ({page}) => {
    await page.route('**/api/v1/adbkeys', r => r.request().method() === 'GET' ?
      r.fulfill({json: {success: true, configured: false, keys: []}}) : r.continue())
    await open(page)
    await expect(ui.keys.card(page)).toContainText('Not configured: start STF with --adb-keys-dir pointing at the ADB_VENDOR_KEYS folder.')
    await expect(ui.keys.nameInput(page)).toHaveCount(0)
    await expect(ui.keys.addButton(page)).toHaveCount(0)
  })

  test('9.5 picking a file fills the name (suffix removed, odd chars become _), a typed name is kept', async ({page}) => {
    await open(page)
    await ui.keys.fileInput(page).setInputFiles(keyFile('my key (1).adb_key'))
    await expect(ui.keys.nameInput(page)).toHaveValue('my_key__1_')
    await expect(ui.keys.card(page)).toContainText('my key (1).adb_key')
    await expect(ui.keys.addButton(page)).toBeEnabled()
    await ui.keys.nameInput(page).fill('typed-name')
    await ui.keys.fileInput(page).setInputFiles(keyFile('other.adb_key'))
    await expect(ui.keys.nameInput(page)).toHaveValue('typed-name')
    await expect(page.locator('body')).not.toContainText('PRIVATE KEY')
  })

  test('9.6 add failure shows the server description and resets the form', async ({page}) => {
    await open(page)
    const name = uniq('parity-bad')
    await ui.keys.fileInput(page).setInputFiles(keyFile(`${name}.adb_key`, 'not a key'))
    await expect(ui.keys.nameInput(page)).toHaveValue(name)
    await ui.keys.addButton(page).click()
    await expect(ui.keys.error(page)).toContainText('not a readable unencrypted PEM private key')
    await expect(ui.keys.nameInput(page)).toHaveValue('')
    await expect(ui.keys.addButton(page)).toBeDisabled()
    expect(await listed(page)).not.toContain(`${name}.adb_key`)
  })

  test('9.4-9.9 add a throwaway key, see it listed, delete with confirm (cancel keeps, OK removes)', async ({page}) => {
    await open(page)
    const name = uniq('parity-throwaway')
    const file = `${name}.adb_key`
    try {
      await ui.keys.fileInput(page).setInputFiles(keyFile(file))
      await expect(ui.keys.nameInput(page)).toHaveValue(name)
      await ui.keys.addButton(page).click()
      const row = ui.keyRow(page, file)
      await expect(row).toBeVisible()
      await expect(row).toContainText(/([0-9a-f]{2}:){15}[0-9a-f]{2}/)
      await expect(row).toContainText(/\d+ B/)
      await expect(row).toContainText(/\d{4}-\d\d-\d\d \d\d:\d\d/)
      await expect(row).not.toContainText('ignored by adb')
      await expect(ui.keys.nameInput(page)).toHaveValue('')

      const cancelled = await ui.confirm(page, () => ui.keyDelete(row).click(), false)
      expect(cancelled).toContain('Delete this ADB key?')
      expect(cancelled).toContain(file)
      await page.waitForTimeout(800)
      expect(await listed(page)).toContain(file)

      await ui.confirm(page, () => ui.keyDelete(row).click(), true)
      await expect(row).toHaveCount(0)
      expect(await listed(page)).not.toContain(file)
    }
    finally {
      await removeIfPresent(page, file)
    }
  })
})
