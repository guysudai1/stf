import {test, expect} from './pw.mjs'
import {ui, route, isNew} from './ui-map.mjs'
import {loginGuest, api} from './support.mjs'

test.describe('3 menu / header / logout', () => {
  test('3.2 header shows Contact Support, the user name, Logout, theme toggle, version, Help', async ({page}) => {
    const name = await loginGuest(page)
    await expect(ui.contactSupport(page)).toBeVisible()
    await expect(ui.currentUser(page)).toHaveText(name)
    await expect(ui.logout(page)).toBeVisible()
    await expect(ui.themeToggle(page)).toBeVisible()
    await expect(ui.version(page)).toHaveText(/^v\d+\.\d+\.\d+/)
    await expect(page.getByText('Help', {exact: true}).or(page.getByLabel('Help'))).toBeVisible()
  })

  test('3.1 admin sees a "Health & Logs" link that opens /health-logs', async ({page}) => {
    await loginGuest(page)
    const me = await api(page, 'GET', '/api/v1/user')
    expect(me.json.user.privilege).toBe('admin')
    await expect(ui.healthLink(page)).toBeVisible()
    await expect(ui.healthLink(page)).toContainText('Health & Logs')
    await ui.healthLink(page).click()
    await expect(page).toHaveURL(/health-logs/)
  })

  test('3.4 logout: POST /auth/api/v1/logout then guest page; /devices then bounces to the guest page', async ({page}) => {
    await loginGuest(page)
    const request = page.waitForRequest(r => r.url().endsWith('/auth/api/v1/logout') && r.method() === 'POST')
    await ui.logout(page).click()
    await request
    await page.waitForURL(/\/auth\/guest\/$/)
    await page.goto(route('/devices'))
    await expect(page).toHaveURL(/\/auth\/guest\//)
    await expect(ui.nickname(page)).toBeVisible()
  })

  test('3.4 (intended difference) logout failure: old stays put, new still returns to the guest page', async ({page}) => {
    await loginGuest(page)
    await page.route('**/auth/api/v1/logout', r => r.fulfill({status: 500, json: {success: false}}))
    await ui.logout(page).click()
    if (isNew) {
      await page.waitForURL(/\/auth\/guest\/$/)
      return
    }
    await page.waitForTimeout(1500)
    expect(page.url()).toMatch(/#!?\/devices/)
    await expect(ui.devicesReady(page)).toBeVisible()
  })

  // The old UI keeps the static title "STF"; the new one appends the page name.
  test('3.5 page title starts with "STF" on the devices and settings pages', async ({page}) => {
    await loginGuest(page)
    await expect(page).toHaveTitle(/^STF/)
    await page.goto(route('/settings'))
    await expect(page).toHaveTitle(/^STF/)
  })

  test('3.6 /health-logs route renders the Health & Logs page for an admin', async ({page}) => {
    await loginGuest(page)
    await page.goto(route('/health-logs'))
    await expect(ui.health.heading(page).first()).toBeVisible()
    await expect(page.getByPlaceholder('Search tag, source, or message')).toBeVisible()
  })
})

test.describe('10 theme', () => {
  test('10.3 toggle flips the theme, label/aria change, survives reload, toggles back', async ({page}) => {
    await loginGuest(page)
    const toggle = ui.themeToggle(page)
    expect(await ui.isDark(page)).toBe(false)
    await toggle.click()
    await expect.poll(() => ui.isDark(page)).toBe(true)
    await page.reload()
    await expect(toggle).toBeVisible()
    await expect.poll(() => ui.isDark(page)).toBe(true)
    await toggle.click()
    await expect.poll(() => ui.isDark(page)).toBe(false)
  })

  test('10.3 (intended difference) toggle label: old shows "Dark theme"/"Light theme", new uses a labelless icon toggle that still switches', async ({page}) => {
    await loginGuest(page)
    const toggle = ui.themeToggle(page)
    if (!isNew) {
      await expect(toggle).toContainText('Dark theme')
      await expect(toggle).toHaveAccessibleName(/dark/i)
    }
    else {
      await expect(toggle).toHaveAccessibleName('color scheme')
    }
    await toggle.click()
    await expect.poll(() => ui.isDark(page)).toBe(true)
    if (!isNew) {
      await expect(toggle).toContainText('Light theme')
      await expect(toggle).toHaveAccessibleName(/light/i)
    }
    await toggle.click()
    await expect.poll(() => ui.isDark(page)).toBe(false)
  })

  test('10.1 default follows prefers-color-scheme: dark at load', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, colorScheme: 'dark'})
    const page = await context.newPage()
    await loginGuest(page)
    await expect.poll(() => ui.isDark(page)).toBe(true)
    await context.close()
  })

  test('10.1 the toggle choice is stored per user (survives a fresh load) and overrides the OS preference', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, colorScheme: 'dark'})
    const page = await context.newPage()
    await loginGuest(page)
    await expect.poll(() => ui.isDark(page)).toBe(true)
    await ui.themeToggle(page).click()
    await expect.poll(() => ui.isDark(page)).toBe(false)
    await page.reload()
    await expect(ui.themeToggle(page)).toBeVisible()
    await page.waitForTimeout(1000)
    expect(await ui.isDark(page)).toBe(false)
    await context.close()
  })

  test('F10.1/F10.2 (intended difference) old stores darkTheme server-side on first toggle (OS default not stored); new switches the scheme and persists it across a reload', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, colorScheme: 'dark'})
    const page = await context.newPage()
    await loginGuest(page)
    await expect.poll(() => ui.isDark(page)).toBe(true)
    const theme = async () => (await api(page, 'GET', '/api/v1/user')).json.user.settings?.darkTheme
    if (!isNew) {
      expect(await theme()).toBeUndefined()
      await ui.themeToggle(page).click()
      await expect.poll(theme).toBe(false)
    }
    else {
      await ui.themeToggle(page).click()
      await expect.poll(() => ui.isDark(page)).toBe(false)
      await page.reload()
      await expect(ui.themeToggle(page)).toBeVisible()
      await page.waitForTimeout(1000)
      expect(await ui.isDark(page)).toBe(false)
    }
    await context.close()
  })
})
