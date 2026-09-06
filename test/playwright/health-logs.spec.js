// System coverage for the administrator health and logs dashboard.

const {test, expect} = require('@playwright/test')
const h = require('./helpers')
const logger = require('../../lib/util/logger')
const wire = require('../../lib/wire')
const wireutil = require('../../lib/wire/util')
const zmqutil = require('../../lib/util/zmqutil')

async function api(page, path) {
  return page.evaluate(async function(url) {
    const response = await fetch(url, {credentials: 'same-origin'})
    const text = await response.text()
    let body = text
    try {
      body = JSON.parse(text)
    }
    catch (e) {
      // Preserve non-JSON responses for a useful assertion failure.
    }
    return {status: response.status, body: body}
  }, path)
}

test.describe('administrator health and logs system behavior', function() {
  test('[check:health_logs] privileged guest can view health summary and logs',
    async function({page}) {
      await h.enterNickname(page)

      const user = await api(page, '/api/v1/user')
      expect(user.status).toBe(200)
      expect(user.body.user.privilege).toBe('root')

      const summary = await api(page, '/api/v1/health/summary')
      expect(summary.status).toBe(200)
      expect(summary.body.summary).toEqual(expect.objectContaining({
        status: expect.any(String),
        devices: expect.objectContaining({
          total: expect.any(Number),
          present: expect.any(Number)
        }),
        logs: expect.objectContaining({
          total: expect.any(Number),
          error: expect.any(Number),
          fatal: expect.any(Number)
        })
      }))

      const logs = await api(page, '/api/v1/health/logs?limit=20')
      expect(logs.status).toBe(200)
      expect(logs.body.logs).toEqual(expect.any(Array))

      await page.goto('/#!/health-logs')
      await page.locator('.stf-health-logs h3').waitFor()
      await expect(page.locator('.stf-health-logs h3')).toContainText(
        'Health & Logs')
      await expect(page.locator('.health-card-label').first()).toHaveText('Status')
      await expect(page.locator('.health-filters')).toBeVisible()

      const message = 'health-system-test-' + Date.now()
      const dealer = zmqutil.socket('dealer')
      dealer.connect('tcp://127.0.0.1:7112')
      try {
        await new Promise(function(resolve) {
          setTimeout(resolve, 500)
        })
        dealer.send([
          wireutil.global
        , wireutil.envelope(new wire.HealthLogMessage(
            Date.now() / 1000
          , logger.Level.IMPORTANT
          , 'system-test'
          , process.pid
          , message
          , 'playwright'
          , 'emulator-5554'
          , 'test'
          ))
        ])
        await expect(page.locator('.health-log-table')).toContainText(message, {
          timeout: 15000
        })
      }
      finally {
        dealer.close()
      }
    })
})
