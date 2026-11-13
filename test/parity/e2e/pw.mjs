import {createRequire} from 'node:module'

const root = process.env.PARITY_PLAYWRIGHT_DIR || new URL('../../../../stf/test/playwright', import.meta.url).pathname
const require = createRequire(root + '/package.json')

import {recordUser} from '../harness.mjs'

const pw = require('@playwright/test')
const base = pw.test
export const {expect, defineConfig, devices} = pw

export const test = base.extend({
  recordUsers: [async ({context}, use) => {
    await use()
    const me = await context.request.get('/api/v1/user').catch(() => null)
    if (me?.ok()) recordUser((await me.json()).user?.email)
  }, {auto: true}]
})
