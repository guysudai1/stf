import fs from 'node:fs'
import http from 'node:http'
import type {AddressInfo} from 'node:net'

import {expect} from 'chai'
import sinon from 'sinon'

import pathutil from '../../../lib/util/pathutil.js'
import {importFresh, mockModule} from '../../helpers/module-mock.mts'

describe('agents guide', function() {
  var server: http.Server, origin: string

  before(async function() {
    var restoreDb = mockModule(new URL('../../../lib/db/api.js', import.meta.url), {default: {}})
    var hasBuild = sinon.stub(fs, 'existsSync').callThrough()
    hasBuild.withArgs(pathutil.resource('build')).returns(true)
    var createServer = http.createServer
    var stub = sinon.stub(http, 'createServer').callsFake(function(app) {
      server = createServer.call(http, app)
      return server
    })

    try {
      var unit = await importFresh(new URL('../../../lib/units/app/index.js', import.meta.url))
      unit.default({
        port: 0
      , ssid: 'agents-test'
      , secret: 'agents-test-secret'
      , authUrl: 'https://stf.test/auth/guest/'
      , websocketUrl: 'https://ws.test/'
      })
    }
    finally {
      stub.restore()
      hasBuild.restore()
      restoreDb()
    }
    await new Promise<void>(function(resolve) {
      server.once('listening', resolve)
    })
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port
  })

  after(function(done) {
    server.close(done)
  })

  it('serves the guide as markdown without a login', async function() {
    var response = await fetch(origin + '/agents.md', {redirect: 'manual'})
    var body = await response.text()
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.equal('text/markdown; charset=utf-8')
    expect(body).to.contain('REST API: https://stf.test/api/v1')
    expect(body).to.contain('Websocket: https://ws.test/')
    expect(body).to.contain('- `POST /api/v1/devices/shell`')
    expect(body).to.not.match(/\{\{[A-Z_]+\}\}/)
  })

  it('serves the same body as plain text at /llms.txt', async function() {
    var md = await (await fetch(origin + '/agents.md')).text()
    var response = await fetch(origin + '/llms.txt', {redirect: 'manual'})
    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.equal('text/plain; charset=utf-8')
    expect(await response.text()).to.equal(md)
  })
})
