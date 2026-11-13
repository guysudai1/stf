import {fileURLToPath} from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {defineConfig} from './pw.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.env.PARITY_TARGET || 'old'
if (!['old', 'new'].includes(target)) throw new Error('PARITY_TARGET must be old or new')

process.env.PARITY_USERS_FILE ??= path.join(os.tmpdir(), `stf-parity-users-${target}-${process.pid}.txt`)

const base = {old: 'http://127.0.0.1:7100', new: 'http://127.0.0.1:7200'}[target]

export default defineConfig({
  testDir: here
, globalTeardown: path.join(here, 'teardown.mjs')
, testMatch: '*.spec.mjs'
, timeout: 120000
, expect: {timeout: 15000}
, fullyParallel: false
, workers: 1
, retries: 0
, reporter: [['list']]
, outputDir: path.join(process.env.TMPDIR || '/tmp', `stf-parity-e2e-${target}`)
, use: {
    baseURL: base
  , viewport: {width: 1600, height: 1000}
  , actionTimeout: 20000
  , navigationTimeout: 60000
  , acceptDownloads: true
  }
})
