import {test, expect} from './pw.mjs'
import {ui, route, SERIAL, isNew} from './ui-map.mjs'
import {uniq, loginGuest, api, releaseMine, freeDevice, openControl, holdViaBrowser} from './support.mjs'
import {login, releaseAll} from '../harness.mjs'

const owner = async page => (await api(page, 'GET', `/api/v1/devices/${SERIAL}?fields=owner.name,owner.email`)).json.device.owner ?? null

test.describe('6 ownership / force release / My Devices', () => {
  test.beforeEach(freeDevice)

  test('6.5 stats tile: "My Devices" label whose tooltip is the user name', async ({page}) => {
    const name = await loginGuest(page)
    await expect(ui.myDevicesLabel(page)).toContainText('My Devices')
    await ui.myDevicesLabel(page).hover()
    await expect(ui.tooltip(page).filter({hasText: name})).toBeVisible({timeout: 5000})
  })

  test('6.4 my own device counts under My Devices and shows Stop Using; stopping releases it', async ({page}) => {
    await loginGuest(page)
    try {
      await openControl(page)
      await page.goto(route('/devices'))
      await expect(ui.stat(page, 'using')).toHaveText('1')
      await expect(ui.statusButton(ui.tile(page)).first()).toHaveText(/Stop Using/)
      expect(await ui.noConfirm(page, () => ui.statusButton(ui.tile(page)).first().click())).toBe(true)
      await expect.poll(() => owner(page)).toBeNull()
      await expect(ui.stat(page, 'using')).toHaveText('0')
    }
    finally {
      await releaseMine(page)
    }
  })

  test("6.4 (intended difference) device claimed through REST by another user: old shows Busy, new shows it as automation (Stop Automation) with a release confirm", async ({page}) => {
    await loginGuest(page)
    const other = await login(uniq('holder'))
    try {
      expect((await other.use()).status).toBe(200)
      const button = ui.statusButton(ui.tile(page)).first()
      if (!isNew) {
        await expect(button).toHaveText(/Busy/)
        await expect(ui.stat(page, 'busy')).toHaveText('1')
        await expect(ui.stat(page, 'using')).toHaveText('0')
        return
      }
      await expect(button).toHaveText(/Stop Automation/)
      await expect(ui.stat(page, 'using')).toHaveText('0')
      const message = await ui.confirm(page, () => button.click(), false)
      expect(message).toContain('Release reservation')
      await page.waitForTimeout(1000)
      expect(await owner(page)).not.toBeNull()
    }
    finally {
      await releaseAll([other])
    }
  })

  test("6.4 a device another user really uses (control page open) is shown as Busy and counts as busy, not mine", async ({page, browser, baseURL}) => {
    await loginGuest(page)
    const other = await holdViaBrowser(browser, baseURL)
    try {
      await expect(ui.statusButton(ui.tile(page)).first()).toHaveText(/Busy/)
      await expect(ui.stat(page, 'busy')).toHaveText('1')
      await expect(ui.stat(page, 'using')).toHaveText('0')
    }
    finally {
      await other.release()
    }
  })

  test('6.1/6.3 force release asks "Force release this device?\\n<serial> — <owner>"; accept releases', async ({page, browser, baseURL}) => {
    await loginGuest(page)
    const other = await holdViaBrowser(browser, baseURL)
    const holder = other.name
    try {
      const button = ui.statusButton(ui.tile(page)).first()
      await expect(button).toHaveText(/Busy/)
      const message = await ui.confirm(page, () => button.click(), true)
      expect(message).toContain('Force release this device?')
      expect(message).toContain(`${SERIAL} — ${holder}`)
      await expect.poll(() => owner(page), {timeout: 15000}).toBeNull()
      expect(page.url()).toMatch(/#!?\/devices/)
    }
    finally {
      await other.release()
    }
  })

  test('F6.1 force release cancel: device stays owned, no navigation, no kick', async ({page, browser, baseURL}) => {
    await loginGuest(page)
    const other = await holdViaBrowser(browser, baseURL)
    const holder = other.name
    try {
      const button = ui.statusButton(ui.tile(page)).first()
      await expect(button).toHaveText(/Busy/)
      const message = await ui.confirm(page, () => button.click(), false)
      expect(message).toContain('Force release this device?')
      await page.waitForTimeout(1500)
      expect((await owner(page)).name).toBe(holder)
      expect(page.url()).toMatch(/#!?\/devices/)
    }
    finally {
      await other.release()
    }
  })

  test('6.3 clicking the tile name/photo of a busy device does nothing special (no confirm, no release)', async ({page, browser, baseURL}) => {
    await loginGuest(page)
    const other = await holdViaBrowser(browser, baseURL)
    try {
            await expect(ui.statusButton(ui.tile(page)).first()).toHaveText(/Busy/)
      expect(await ui.noConfirm(page, () => ui.tile(page).locator('.device-name').click())).toBe(true)
      expect(await owner(page)).not.toBeNull()
      expect(page.url()).toMatch(/#!?\/devices/)
    }
    finally {
      await other.release()
    }
  })

  test('6.4 control page of a device held by another user does not offer Stop Using', async ({page, browser, baseURL}) => {
    await loginGuest(page)
    const other = await holdViaBrowser(browser, baseURL)
    try {
            await page.goto(route(`/control/${SERIAL}`))
      await page.waitForTimeout(3000)
      await expect(ui.stopUsing(page)).toHaveCount(0)
      expect(await owner(page)).not.toBeNull()
    }
    finally {
      await other.release()
      await releaseMine(page)
    }
  })
})
