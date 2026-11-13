import {expect} from 'chai'

import {loadSwagger, render, renderEndpoints, type Swagger} from '../../lib/util/agents-guide.js'

var urls = {
  appUrl: 'https://stf.test'
, apiUrl: 'https://stf.test/api/v1'
, websocketUrl: 'https://ws.test/'
, authUrl: 'https://stf.test/auth/guest/'
}

var swagger: Swagger = {
  basePath: '/api/v1'
, paths: {
    '/b': {
      post: {summary: 'Makes b', tags: ['user'], parameters: [
        {name: 'id', in: 'path', required: true}
      , {name: 'opt', in: 'query'}
      ]}
    , get: {summary: 'Gets b', tags: ['user']}
    }
  , '/a': {get: {summary: 'Gets a', tags: ['admin', 'devices']}}
  , '/c': {get: {summary: 'Gets c'}, parameters: []}
  , '/z': {get: {summary: 'Gets z', tags: ['custom']}}
  }
}

describe('agents-guide', function() {
  it('fills every placeholder and leaves unknown ones alone', function() {
    var out = render(
      '{{APP_URL}} {{API_URL}} {{WEBSOCKET_URL}} {{AUTH_URL}} {{NOPE}}'
    , swagger
    , urls
    )
    expect(out).to.equal(
      'https://stf.test https://stf.test/api/v1 https://ws.test/ ' +
      'https://stf.test/auth/guest/ {{NOPE}}'
    )
  })

  it('inserts the endpoint reference', function() {
    expect(render('x\n{{ENDPOINTS}}', swagger, urls)).to.contain('### devices')
  })

  it('marks admin operations and groups by first non-admin tag, sorted', function() {
    var out = renderEndpoints(swagger)
    var groups = out.match(/^### .*$/gm)
    expect(groups).to.deep.equal(['### custom', '### devices', '### other', '### user'])
    expect(out).to.contain('- `GET /api/v1/a` - Gets a (admin)')
    expect(out).to.not.contain('Gets b (admin)')
  })

  it('sorts operations by path then method and lists required parameters', function() {
    var user = renderEndpoints(swagger).split('### user')[1]!
    expect(user.indexOf('`GET /api/v1/b`')).to.be.lessThan(user.indexOf('`POST /api/v1/b`'))
    expect(user).to.contain('Makes b [requires: id (path)]')
  })

  it('puts untagged operations under other and ignores non-operation keys', function() {
    var out = renderEndpoints(swagger)
    expect(out).to.contain('### other\n\n- `GET /api/v1/c` - Gets c\n')
  })

  it('loads the real API definition', function() {
    var out = renderEndpoints(loadSwagger())
    expect(out).to.contain(
      '- `POST /api/v1/devices/shell` - Runs a shell command on all devices (admin)'
    )
    expect(out).to.contain('`DELETE /api/v1/user/devices/{serial}`')
  })
})
