import {test, expect} from './pw.mjs'
import {ui, route, isNew} from './ui-map.mjs'
import {uniq, loginGuest} from './support.mjs'

test.describe('1 guest login page', () => {
  test('1.1 page elements: logo, nickname input attributes, Continue submit', async ({page}) => {
    await page.goto('/auth/guest/')
    await expect(page.locator('img[src*="STF-512"]')).toBeVisible()
    const input = ui.nickname(page)
    await expect(input).toHaveAttribute('placeholder', 'Nickname')
    await expect(input).toHaveAttribute('maxlength', '64')
    await expect(input).toHaveAttribute('autocomplete', 'nickname')
    await expect(input).toHaveAttribute('autocapitalize', 'off')
    await expect(input).toHaveAttribute('autocorrect', 'off')
    await expect(input).toHaveAttribute('spellcheck', 'false')
    expect(await input.evaluate(e => e.required)).toBe(true)
    await expect(ui.continueButton(page)).toBeVisible()
    await expect(page).toHaveTitle('STF')
  })

  test('1.2 touched and empty shows the warning, untouched does not', async ({page}) => {
    await page.goto('/auth/guest/')
    await expect(page.getByText('Please enter a nickname', {exact: true})).toBeHidden()
    await ui.nickname(page).fill('x')
    await ui.nickname(page).fill('')
    await ui.nickname(page).blur()
    await expect(page.getByText('Please enter a nickname', {exact: true})).toBeVisible()
  })

  test('1.3 submit POSTs {name} and replaces the page (Back does not return to the form)', async ({page}) => {
    await page.goto('/auth/guest/')
    await ui.nickname(page).fill(uniq('pe'))
    const request = page.waitForRequest(r => r.url().endsWith('/auth/api/v1/guest') && r.method() === 'POST')
    await ui.continueButton(page).click()
    const posted = (await request).postDataJSON()
    expect(Object.keys(posted)).toEqual(['name'])
    await page.waitForURL(/#!?\/devices/, {timeout: 60000})
    await expect(ui.devicesReady(page)).toBeVisible()
    await page.goBack().catch(() => null)
    expect(page.url()).not.toContain('/auth/guest')
  })

  test('1.4 error messages: ValidationError, other failure, cleared on next submit', async ({page}) => {
    let mode = 'invalid'
    await page.route('**/auth/api/v1/guest', route => {
      if (mode === 'invalid') return route.fulfill({status: 400, json: {success: false, error: 'ValidationError'}})
      if (mode === 'conflict') return route.fulfill({status: 409, json: {success: false, error: 'AlreadySet'}})
      return route.abort()
    })
    await page.goto('/auth/guest/')
    await ui.nickname(page).fill('abc')
    await ui.continueButton(page).click()
    await expect(page.getByText('Please enter a valid nickname')).toBeVisible()
    mode = 'conflict'
    await ui.continueButton(page).click()
    await expect(page.getByText('Server error. Check log output.')).toBeVisible()
    await expect(page.getByText('Please enter a valid nickname')).toBeHidden()
    mode = 'network'
    await ui.continueButton(page).click()
    await expect(page.getByText('Server error. Check log output.')).toBeVisible()
  })

  test('F1.2 empty submit still POSTs and shows "Please enter a valid nickname"', async ({page}) => {
    await page.goto('/auth/guest/')
    const request = page.waitForRequest(r => r.url().endsWith('/auth/api/v1/guest') && r.method() === 'POST')
    await ui.continueButton(page).click()
    await request
    await expect(page.getByText('Please enter a valid nickname')).toBeVisible()
    await expect(page).toHaveURL(/\/auth\/guest\//)
  })

  test('F1.5 whitespace-only nickname is rejected by the server with the same message', async ({page}) => {
    await page.goto('/auth/guest/')
    await ui.nickname(page).fill('   ')
    await ui.continueButton(page).click()
    await expect(page.getByText('Please enter a valid nickname')).toBeVisible()
  })

  test('1.5 (intended difference) unknown route under the guest app: old redirects to /auth/guest/, new keeps rendering the login form', async ({page}) => {
    await page.goto('/auth/guest/')
    await expect(ui.nickname(page)).toBeVisible()
    await page.evaluate(() => {
      history.pushState({}, '', '/auth/guest/nope/deeper')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    if (isNew) {
      await page.waitForTimeout(1000)
      await expect(ui.nickname(page)).toBeVisible()
      await expect(ui.continueButton(page)).toBeVisible()
      await expect(page).toHaveURL(/\/auth\/guest\//)
      return
    }
    await expect(page).toHaveURL(/\/auth\/guest\/$/)
    await expect(ui.nickname(page)).toBeVisible()
  })

  test('1.6 (intended difference) guest page: old is not themed by the OS dark preference, new follows it', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, colorScheme: 'dark'})
    const page = await context.newPage()
    await page.goto('/auth/guest/')
    await expect(ui.nickname(page)).toBeVisible()
    expect(await ui.isDark(page)).toBe(isNew)
    await context.close()
  })

  test('1.8 logout lands back on the guest page', async ({page}) => {
    await loginGuest(page)
    await ui.logout(page).click()
    await page.waitForURL(/\/auth\/guest\/$/)
    await expect(ui.nickname(page)).toBeVisible()
  })
})
