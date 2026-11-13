import {test, expect} from './pw.mjs'
import {ui, SERIAL} from './ui-map.mjs'
import {loginGuest} from './support.mjs'

const buttons = page => page.locator('ul.devices-icon-view > li:not(.filter-out) button.device-status')

test.describe('7 connection states (only what is observable)', () => {
  test('7.1 a present, ready device is shown as available ("Use"), never as Connected/Present', async ({page}) => {
    await loginGuest(page)
    const button = ui.statusButton(ui.tile(page)).first()
    await expect(button).toHaveText('Use')
    await expect(page.locator('ul.devices-icon-view')).not.toContainText(/\b(Connected|Present)\b/)
  })

  test('7.1 an absent device is labelled "Disconnected" and cannot be used', async ({page}) => {
    await loginGuest(page)
    const absent = buttons(page).filter({hasText: 'Disconnected'})
    test.skip(await absent.count() === 0, 'no absent device is listed on this server, so the state is not observable')
    await expect(absent).toHaveCount(1)
    await expect(absent.first()).toBeVisible()
    await expect(page.locator('ul.devices-icon-view > li:has(button:text-is("Disconnected")) a[href]')).toHaveCount(0)
  })
})
