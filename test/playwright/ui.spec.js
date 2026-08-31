//
// UI tests that do not need a real device attached.
//
// Test titles carry a [check:<key>] tag; .github/scripts/playwright-checks.js
// turns those into the per-Android-version columns of the PR report.
//

const {test, expect} = require('@playwright/test')
const h = require('./helpers')

test.describe('STF web UI', function() {
  test.describe.configure({mode: 'serial'})

  test('[check:playwright_ui] nickname entry lands on the device list',
    async function({page}) {
      const errors = await h.collectConsoleErrors(page)

      await page.goto('/auth/guest/')
      await expect(page.locator(h.SEL.nicknameForm)).toBeVisible()
      await expect(page.locator(h.SEL.nicknameInput)).toBeVisible()
      await expect(page.locator(h.SEL.nicknameSubmit)).toBeVisible()

      await page.fill(h.SEL.nicknameInput, h.USER_NAME)
      await page.click(h.SEL.nicknameSubmit)

      await page.waitForURL(/#!\/devices/, {timeout: 90000})
      await expect(page.locator(h.SEL.deviceList)).toBeVisible()
      await expect(page.locator(h.SEL.nicknameError)).toHaveCount(0)

      // Angular templates that fail to resolve show up here and nowhere else.
      const fatal = errors.filter(function(text) {
        return /\[\$injector|\[\$compile|Unexpected token|is not a function/
          .test(text)
      })
      expect(fatal, 'fatal angular errors on the device list').toEqual([])
    })

  test('[check:playwright_ui] the menu reports a version and the guest user',
    async function({page}) {
      await h.enterNickname(page)

      await expect(page.locator(h.SEL.version)).toHaveText(/^v\d+\.\d+\.\d+/)
      await expect(
        page.locator('.device-stats .text[ng-bind="currentUser.name"]')
      ).toHaveText(h.USER_NAME)
    })

  test('[check:playwright_ui] the device list search box filters tiles',
    async function({page}) {
      await h.enterNickname(page)

      const search = page.locator(h.SEL.deviceSearch)
      await expect(search).toBeVisible()

      // A query that cannot match anything must hide every tile. Filtered
      // tiles keep their DOM node and gain .filter-out, hence the :not() in
      // SEL.deviceTiles.
      await search.fill('zzz-no-such-device-zzz')
      await expect(page.locator(h.SEL.deviceTiles)).toHaveCount(0, {
        timeout: 20000
      })

      await search.fill('')
      await expect(page.locator(h.SEL.deviceSearch)).toHaveValue('')
    })

  test('[check:playwright_ui] the settings page renders',
    async function({page}) {
      await h.enterNickname(page)

      await page.goto('/#!/settings')
      await expect(page.locator('[ng-controller="SettingsCtrl"]'))
        .toBeVisible({timeout: 30000})
      await expect(
        page.locator('[ng-controller="SettingsCtrl"] .heading-for-tabs')
      ).toBeVisible()
    })
})
