import {expect} from './pw.mjs'
import {Jar, Session, login, uniq, recordUser} from '../harness.mjs'
import {ui, route, SERIAL} from './ui-map.mjs'

export {uniq}

export async function loginGuest(page, name = uniq('pe')) {
  await page.goto('/auth/guest/')
  await ui.nickname(page).fill(name)
  await ui.continueButton(page).click()
  await page.waitForURL(/#!?\/devices/, {timeout: 60000})
  await expect(ui.devicesReady(page)).toBeVisible({timeout: 30000})
  await recordPageUser(page)
  return name
}

export async function api(page, method, path, body) {
  return page.evaluate(async ({method, path, body}) => {
    const token = document.cookie.split('; ').find(c => c.startsWith('XSRF-TOKEN='))
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (token) headers['X-XSRF-TOKEN'] = decodeURIComponent(token.slice(11))
    const res = await fetch(path, {
      method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    return {status: res.status, json, text}
  }, {method, path, body})
}

export async function recordPageUser(page) {
  const me = await page.context().request.get('/api/v1/user').catch(() => null)
  if (me?.ok()) recordUser((await me.json()).user?.email)
}

export const releaseMine = page => api(page, 'DELETE', `/api/v1/user/devices/${SERIAL}`).catch(() => null)

export async function gotoSettings(page, tab) {
  await page.goto(route('/settings'))
  await ui.settingsTab(page, tab).waitFor()
  await ui.settingsTab(page, tab).click()
}

export async function openControl(page) {
  await page.goto(route(`/control/${SERIAL}`))
  await expect(ui.controlReady(page)).toBeVisible({timeout: 60000})
}

// A harness session acting as the same user as the browser (shares its cookies).
export async function sessionFor(page) {
  const jar = new Jar()
  for (const c of await page.context().cookies()) jar.cookies.set(c.name, c.value)
  const me = await api(page, 'GET', '/api/v1/user')
  return new Session(jar, me.json.user, true)
}

// Leaves the shared device unowned whoever holds it (any admin may force release).
export async function freeDevice() {
  const admin = await login(uniq('freer'))
  try {
    await admin.stop(SERIAL)
  }
  finally {
    await admin.cleanup()
  }
}

// A second browser user who really uses the device through the UI (opens its control page).
export async function holdViaBrowser(browser, baseURL) {
  const context = await browser.newContext({baseURL, viewport: {width: 1600, height: 1000}})
  const page = await context.newPage()
  const name = await loginGuest(page, uniq('holder'))
  await openControl(page)
  return {
    name
  , page
  , release: async () => {
      await releaseMine(page)
      await context.close()
    }
  }
}
