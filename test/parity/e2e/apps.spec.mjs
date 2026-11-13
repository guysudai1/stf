import {test, expect} from './pw.mjs'
import {ui, isNew} from './ui-map.mjs'
import {loginGuest, openControl, releaseMine, freeDevice} from './support.mjs'

async function openApps(page) {
  await loginGuest(page)
  await openControl(page)
  await ui.paneTab(page, 'Apps').click()
  const root = ui.appsRoot(page)
  await expect(root).toContainText('Installed apps')
  await expect(ui.apps.rows(root).first()).toBeVisible({timeout: 60000})
  return root
}

const column = async (root, index) => ui.apps.rows(root).evaluateAll(
  (rows, i) => rows.map(r => r.children[i].innerText.trim()), index)
const th = (root, title) => ui.apps.headers(root).filter({hasText: title})

test.describe('8 Apps tab', () => {
  test.beforeEach(freeDevice)
  test.afterEach(async ({page}) => { await releaseMine(page) })

  test('8.1 Apps tab sits after File Explorer and before Info', async ({page}) => {
    await loginGuest(page)
    await openControl(page)
    const names = (await ui.paneTabNames(page)).map(t => t.trim())
    const apps = names.indexOf('Apps')
    expect(apps).toBeGreaterThan(-1)
    expect(names[apps - 1]).toBe('File Explorer')
    expect(names[apps + 1]).toBe('Info')
  })

  test('8.2/8.8/8.9 heading, count badge equals rows, filter narrows rows and count, columns', async ({page}) => {
    const root = await openApps(page)
    const total = await ui.apps.rows(root).count()
    await expect(ui.appsBadge(root)).toHaveText(String(total))
    const headers = (await ui.apps.headers(root).allInnerTexts()).map(t => t.trim())
    expect(headers).toEqual(['App', 'Version', 'Code', 'Target SDK', 'Installed', 'Updated', 'MD5'])
    const first = (await column(root, 0))[0]
    await ui.apps.search(root).fill(first.toUpperCase())
    await expect(ui.apps.rows(root)).not.toHaveCount(0)
    const shown = await column(root, 0)
    expect(shown).toContain(first)
    await expect(ui.appsBadge(root)).toHaveText(String(shown.length))
    await ui.apps.search(root).fill('zzz-no-such-package-zzz')
    await expect(ui.apps.rows(root)).toHaveCount(0)
    await expect(ui.appsBadge(root)).toHaveText('0')
  })

  test('8.9/8.10 default sort is name ascending; header click sorts asc, same header toggles; others reset', async ({page}) => {
    const root = await openApps(page)
    const names = await column(root, 0)
    const sortedAsc = [...names].sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1)
    expect(names).toEqual(sortedAsc)
    expect(await ui.sortState(th(root, 'App').first())).toBe('asc')
    await th(root, 'App').first().click()
    await expect.poll(async () => ui.sortState(th(root, 'App').first())).toBe('desc')
    expect(await column(root, 0)).toEqual([...sortedAsc].reverse())
    await th(root, 'Code').first().click()
    await expect.poll(async () => ui.sortState(th(root, 'Code').first())).toBe('asc')
    expect(await ui.sortState(th(root, 'App').first())).toBe('none')
    const codes = (await column(root, 2)).map(Number)
    expect(codes).toEqual([...codes].sort((a, b) => a - b))
    await th(root, 'Code').first().click()
    await expect.poll(async () => ui.sortState(th(root, 'Code').first())).toBe('desc')
    const down = (await column(root, 2)).map(Number)
    expect(down).toEqual([...down].sort((a, b) => b - a))
  })

  test('8.3/8.4 "Include system apps" reloads with more rows; refresh keeps working', async ({page}) => {
    const root = await openApps(page)
    const before = await ui.apps.rows(root).count()
    await ui.apps.system(root).check()
    await expect.poll(() => ui.apps.rows(root).count(), {timeout: 30000}).toBeGreaterThan(before)
    await ui.apps.system(root).uncheck()
    await expect.poll(() => ui.apps.rows(root).count(), {timeout: 30000}).toBe(before)
    await ui.appsRefresh(root).click()
    await expect(ui.apps.rows(root).first()).toBeVisible({timeout: 30000})
  })

  test('8.12 (intended difference) Get MD5 shows a 32 hex digest in that row only; old drops it on reload, new keeps it', async ({page}) => {
    const root = await openApps(page)
    const row = ui.apps.rows(root).first()
    const buttons = await ui.md5Button(root).count()
    await ui.md5Button(row).click()
    await expect(row.locator('td').last()).toContainText(/^[0-9a-f]{32}$/, {timeout: 30000})
    await expect(ui.md5Button(root)).toHaveCount(buttons - 1)
    await ui.appsRefresh(root).click()
    await expect(ui.md5Button(root)).toHaveCount(isNew ? buttons - 1 : buttons, {timeout: 30000})
  })

  test('8.11 resize drag on a column handle changes its width and the following click does not sort', async ({page}) => {
    const root = await openApps(page)
    const header = th(root, 'Version').first()
    const before = (await header.boundingBox()).width
    const handle = ui.resizeHandle(header)
    const box = await handle.boundingBox()
    const y = box.y + box.height / 2
    const x = box.x + box.width / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 40, y, {steps: 5})
    await page.mouse.move(x + 60, y, {steps: 5})
    await page.mouse.up()
    expect((await header.boundingBox()).width).toBeGreaterThan(before + 30)
    expect(await ui.sortState(header)).toBe('none')
    expect(await ui.sortState(th(root, 'App').first())).toBe('asc')
    // the swallowed click is one-shot: the next plain click sorts
    await header.locator('span').first().click()
    await expect.poll(async () => ui.sortState(header)).toBe('asc')
  })

  test('8.11 (intended fix) a drag released outside the header: old swallows the next header click, new does not', async ({page}) => {
    const root = await openApps(page)
    const header = th(root, 'Version').first()
    const box = await ui.resizeHandle(header).boundingBox()
    const y = box.y + box.height / 2
    const x = box.x + box.width / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 30, y + 300, {steps: 6})
    await page.mouse.up()
    await header.locator('span').first().click()
    if (isNew) {
      await expect.poll(async () => ui.sortState(header)).toBe('asc')
    }
    else {
      await page.waitForTimeout(600)
      expect(await ui.sortState(header)).toBe('none')
      await header.locator('span').first().click()
      await expect.poll(async () => ui.sortState(header)).toBe('asc')
    }
  })
})
