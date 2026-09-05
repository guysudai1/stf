// System coverage for the all-users-admin privilege model.
//
// These tests use the authenticated browser session so they exercise the
// complete auth -> API path, including the guest session and CSRF handling.

const {test, expect} = require('@playwright/test')
const h = require('./helpers')

async function api(page, path, options) {
  options = options || {}
  return page.evaluate(async function(args) {
    const tokenCookie = document.cookie.split('; ').find(function(cookie) {
      return cookie.indexOf('XSRF-TOKEN=') === 0
    })
    const headers = {}
    if (args.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }
    if (tokenCookie) {
      headers['X-XSRF-TOKEN'] = decodeURIComponent(
        tokenCookie.slice('XSRF-TOKEN='.length)
      )
    }

    const response = await fetch(args.path, {
      method: args.method || 'GET'
    , credentials: 'same-origin'
    , headers: headers
    , body: args.body === undefined ? undefined : JSON.stringify(args.body)
    })
    const text = await response.text()
    let body = text
    try {
      body = JSON.parse(text)
    }
    catch (e) {
      // Keep non-JSON responses, such as the Prometheus metrics endpoint.
    }
    return {status: response.status, body: body}
  }, {
    path: path
  , method: options.method
  , body: options.body
  })
}

test.describe('all-users-admin system behavior', function() {
  test.describe.configure({mode: 'serial'})

  test('[check:root_permissions] guest authentication grants root privilege',
    async function({page}) {
      await h.enterNickname(page)

      const currentUser = await api(page, '/api/v1/user')
      expect(currentUser.status).toBe(200)
      expect(currentUser.body.user.privilege).toBe('root')

      const metrics = await api(page, '/api/v1/metrics')
      expect(metrics.status).toBe(200)
      expect(metrics.body).toContain('stf_')
    })

  test('[check:root_permissions] new users receive root privilege',
    async function({page}) {
      await h.enterNickname(page)

      const suffix = Date.now() + '-' + Math.random().toString(16).slice(2)
      const email = 'stf-root-permissions-' + suffix + '@localhost'

      try {
        const createdUser = await api(page, '/api/v1/users/' +
          encodeURIComponent(email) + '?name=System%20test%20user', {
            method: 'POST'
          })
        expect(createdUser.status).toBe(201)
        expect(createdUser.body.user.privilege).toBe('root')
      }
      finally {
        const deletedUser = await api(page, '/api/v1/users/' +
          encodeURIComponent(email), {method: 'DELETE'})
        expect([200, 404]).toContain(deletedUser.status)
      }
    })

  test('[check:root_permissions] the built-in root owner cannot be deleted',
    async function({page}) {
      await h.enterNickname(page)

      const groups = await api(page, '/api/v1/groups')
      expect(groups.status).toBe(200)
      const rootGroup = groups.body.groups.find(function(group) {
        return group.name === 'Common' &&
          group.owner.email === 'admin@localhost'
      })
      expect(rootGroup, 'the built-in Common root group is visible').toBeTruthy()

      const result = await api(page, '/api/v1/users/' +
        encodeURIComponent(rootGroup.owner.email), {method: 'DELETE'})
      expect(result.status).toBe(403)
    })
})
