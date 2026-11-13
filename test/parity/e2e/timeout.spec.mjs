import {test, expect} from './pw.mjs'
import {ui, isNew} from './ui-map.mjs'
import {loginGuest, api, gotoSettings, sessionFor} from './support.mjs'

const stored = async page => (await api(page, 'GET', '/api/v1/user')).json.user.settings?.deviceTimeout
const storedEventually = (page, value) => expect.poll(() => stored(page), {timeout: 10000}).toBe(value)

async function open(page) {
  await loginGuest(page)
  await gotoSettings(page, 'General')
  await expect(ui.timeoutInput(page)).toBeVisible()
}

test.describe('2 device timeout (Settings > General)', () => {
  test('2.1/2.2 widget: label, input constraints, help text, Save and Reset', async ({page}) => {
    await open(page)
    const input = ui.timeoutInput(page)
    await expect(input).toHaveAttribute('inputmode', 'numeric')
    await expect(input).toHaveValue('')
    await expect(page.getByLabel('Timeout (seconds)')).toBeVisible()
    await expect(ui.timeoutHelp(page)).toBeVisible()
    await expect(ui.saveTimeout(page)).toBeVisible()
    await expect(ui.timeoutReset(page)).toBeVisible()
  })

  test('2.6/2.8 save stores seconds*1000, survives reload; Reset stores null at once', async ({page}) => {
    await open(page)
    await ui.timeoutInput(page).fill('30')
    await ui.saveTimeout(page).click()
    await storedEventually(page, 30000)
    await page.reload()
    await expect(ui.timeoutInput(page)).toHaveValue('30')
    await ui.timeoutReset(page).click()
    await expect(ui.timeoutInput(page)).toHaveValue('')
    await storedEventually(page, null)
  })

  test('2.6 saving a blank field stores null', async ({page}) => {
    await open(page)
    await ui.timeoutInput(page).fill('45')
    await ui.saveTimeout(page).click()
    await storedEventually(page, 45000)
    await ui.timeoutInput(page).fill('')
    await ui.saveTimeout(page).click()
    await storedEventually(page, null)
  })

  test('F2.2 Enter in the input saves', async ({page}) => {
    await open(page)
    await ui.timeoutInput(page).fill('12')
    await ui.timeoutInput(page).press('Enter')
    await storedEventually(page, 12000)
  })

  test('2.8 saving does not wipe other settings (theme survives)', async ({page}) => {
    await loginGuest(page)
    await ui.themeToggle(page).click()
    await expect.poll(() => ui.isDark(page)).toBe(true)
    await gotoSettings(page, 'General')
    await ui.timeoutInput(page).fill('20')
    await ui.saveTimeout(page).click()
    await storedEventually(page, 20000)
    await page.reload()
    await expect.poll(() => ui.isDark(page)).toBe(true)
  })

  // AngularJS's min/max/step validators leave the model undefined, so the old UI saves null.
  for (const bad of ['0', '-1', '1.5', '86401']) {
    test(`2.5 (intended difference) out-of-range value ${bad}: old treats it as blank, new shows the error and disables Save`, async ({page}) => {
      await open(page)
      await ui.timeoutInput(page).fill('30')
      await ui.saveTimeout(page).click()
      await storedEventually(page, 30000)
      await ui.timeoutInput(page).fill(bad)
      if (isNew) {
        await expect(ui.timeoutError(page)).toBeVisible()
        await expect(ui.saveTimeout(page)).toBeDisabled()
        await page.waitForTimeout(500)
        await storedEventually(page, 30000)
        return
      }
      await page.waitForTimeout(500)
      await expect(ui.timeoutError(page)).toBeHidden()
      await expect(ui.saveTimeout(page)).toBeEnabled()
      await ui.saveTimeout(page).click()
      await storedEventually(page, null)
    })
  }

  test('2.3 a stored value shows as seconds, an invalid stored value (1500 ms) as blank', async ({page}) => {
    await open(page)
    const session = await sessionFor(page)
    try {
      const socket = await session.socket()
      socket.emit('user.settings.update', {deviceTimeout: 45000})
      await storedEventually(page, 45000)
      await page.reload()
      await expect(ui.timeoutInput(page)).toHaveValue('45')
      socket.emit('user.settings.update', {deviceTimeout: 1500})
      await storedEventually(page, 1500)
      await page.reload()
      await expect(ui.timeoutInput(page)).toBeVisible()
      await expect(ui.timeoutInput(page)).toHaveValue('')
      socket.emit('user.settings.update', {deviceTimeout: null})
      await storedEventually(page, null)
    }
    finally {
      await session.cleanup()
    }
  })
})
