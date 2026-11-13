import http from 'node:http'
import type {AddressInfo} from 'node:net'

import * as chai from 'chai'
var expect = chai.expect

import jwtutil from '../../../lib/util/jwtutil.js'
import type AuthGuest from '../../../lib/units/auth/guest.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

var saved: {name: string, email: string, ip: string}[] = []
var names = new Map<string, string>()

mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {
  getUsers: () => Promise.resolve([])
, getDevices: () => Promise.resolve([])
, getRootGroup: () => Promise.resolve({owner: {email: 'admin@example.com'}})
, saveUserAfterLogin: function(user: {name: string, email: string, ip: string}) {
    saved.push(user)
    var old = names.get(user.email)
    if (old && old !== user.name) {
      return Promise.resolve(null)
    }
    names.set(user.email, user.name)
    return Promise.resolve({inserted: 1})
  }
}})

var authGuest: typeof AuthGuest =
  (await importFresh(new URL('../../../lib/units/auth/guest.js', import.meta.url))).default

describe('auth-guest', function() {
  var server: http.Server, port: number, cookies: string[]

  before(function(done) {
    var createServer: (app: http.RequestListener) => http.Server = http.createServer
    http.createServer = function(app: http.RequestListener) {
      server = createServer.call(http, app)
      return server
    } as typeof http.createServer
    try {
      authGuest({port: 0, secret: 'test-secret', ssid: 'ssid', appUrl: 'http://127.0.0.1:7105/'})
    }
    finally {
      http.createServer = createServer as typeof http.createServer
    }
    server.once('listening', function() {
      port = (server.address() as AddressInfo).port
      done()
    })
  })

  after(function(done) {
    server.close(function() {
      done()
    })
  })

  async function fresh() {
    cookies = []
    await request('GET', '/auth/guest/')
  }

  beforeEach(async function() {
    saved = []
    names.clear()
    await fresh()
  })

  function request(method: string, path: string, body?: object, accept = 'application/json') {
    return new Promise<{status: number, body: any, headers: http.IncomingHttpHeaders}>(
      function(resolve, reject) {
        var payload = body ? JSON.stringify(body) : undefined
        var headers: http.OutgoingHttpHeaders = {accept: accept, cookie: cookies.join('; ')}
        var xsrf = cookies.find((c) => c.startsWith('XSRF-TOKEN='))
        if (xsrf) {
          headers['x-xsrf-token'] = decodeURIComponent(xsrf.split('=')[1]!)
        }
        if (payload) {
          headers['content-type'] = 'application/json'
        }
        var req = http.request({host: '127.0.0.1', port: port, path: path, method: method
        , headers: headers}, function(res) {
          var text = ''
          res.on('data', function(chunk) {
            text += chunk
          })
          res.on('end', function() {
            var setCookies = res.headers['set-cookie'] || []
            setCookies.forEach(function(c) {
              var pair = c.split(';')[0]!
              var name = pair.split('=')[0]
              cookies = cookies.filter((old) => !old.startsWith(name + '='))
              cookies.push(pair)
            })
            var parsed: any = text
            try {
              parsed = JSON.parse(text)
            }
            catch {
              // Not JSON
            }
            resolve({status: res.statusCode!, body: parsed, headers: res.headers})
          })
        })
        req.on('error', reject)
        req.end(payload)
      })
  }

  it('should redirect / to the guest page', async function() {
    var res = await request('GET', '/')
    expect(res.status).to.equal(302)
    expect(res.headers.location).to.equal('/auth/guest/')
  })

  it('should not serve the guest page without a trailing slash', async function() {
    expect((await request('GET', '/auth/guest')).status).to.equal(404)
  })

  it('should log in with a nickname and issue a 24 hour token', async function() {
    var before = Date.now()
    var res = await request('POST', '/auth/api/v1/guest', {name: '  alice  '})
    expect(res.status).to.equal(200)
    expect(res.body.success).to.equal(true)
    var url = new URL(res.body.redirect)
    expect(url.origin + url.pathname).to.equal('http://127.0.0.1:7105/')
    var token = url.searchParams.get('jwt')!
    var payload = jwtutil.decode(token, 'test-secret')!
    expect(payload.name).to.equal('alice')
    expect(payload.email).to.match(/^guest-[0-9a-f]{32}@guest\.local$/)
    var exp = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()).exp
    expect(exp - before).to.be.within(24 * 3600 * 1000 - 1000, 24 * 3600 * 1000 + 5000)
  })

  it('should reject an empty, blank or too long nickname', async function() {
    for (var name of ['', '   ', 'x'.repeat(65)]) {
      var res = await request('POST', '/auth/api/v1/guest', {name: name})
      expect(res.status).to.equal(400)
      expect(res.body.error).to.equal('ValidationError')
      expect(res.body.success).to.equal(false)
    }
  })

  it('should answer 409 when the same guest changes the nickname', async function() {
    expect((await request('POST', '/auth/api/v1/guest', {name: 'alice'})).status).to.equal(200)
    var res = await request('POST', '/auth/api/v1/guest', {name: 'bob'})
    expect(res.status).to.equal(409)
    expect(res.body).to.deep.equal({success: false, error: 'NicknameAlreadySet'})
    expect((await request('POST', '/auth/api/v1/guest', {name: 'alice'})).status).to.equal(200)
  })

  it('should allow two guests with the same nickname', async function() {
    expect((await request('POST', '/auth/api/v1/guest', {name: 'alice'})).status).to.equal(200)
    await fresh()
    expect((await request('POST', '/auth/api/v1/guest', {name: 'alice'})).status).to.equal(200)
    expect(saved[0]!.email).to.not.equal(saved[1]!.email)
  })

  it('should answer 406 when JSON is not accepted', async function() {
    var res = await request('POST', '/auth/api/v1/guest', {name: 'alice'}, 'text/html')
    expect(res.status).to.equal(406)
  })

  it('should forget the identity on logout', async function() {
    await request('POST', '/auth/api/v1/guest', {name: 'alice'})
    var first = saved[0]!.email
    var res = await request('POST', '/auth/api/v1/logout')
    expect(res.status).to.equal(200)
    expect(res.body).to.deep.equal({success: true})
    await request('GET', '/auth/guest/')
    await request('POST', '/auth/api/v1/guest', {name: 'alice'})
    expect(saved[1]!.email).to.not.equal(first)
  })

  it('should answer /auth/contact with the root owner', async function() {
    var res = await request('GET', '/auth/contact')
    expect(res.status).to.equal(200)
    expect(res.body.contact.email).to.equal('admin@example.com')
  })
})
