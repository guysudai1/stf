import fs from 'fs'
import path from 'path'
import {createRequire} from 'module'

import pathutil from './pathutil.js'

interface SwaggerParameter {
  name: string
  in: string
  required?: boolean
}

interface SwaggerOperation {
  summary?: string
  tags?: string[]
  parameters?: SwaggerParameter[]
}

export interface Swagger {
  basePath?: string
  paths: Record<string, Record<string, SwaggerOperation | unknown>>
}

export interface GuideUrls {
  appUrl: string
  apiUrl: string
  websocketUrl: string
  authUrl: string
}

var methods = ['get', 'put', 'post', 'delete', 'patch']

function describeParameters(operation: SwaggerOperation) {
  var required = (operation.parameters || []).filter(function(parameter) {
    return parameter.required
  })
  if (!required.length) {
    return ''
  }
  return ' [requires: ' + required.map(function(parameter) {
    return parameter.name + ' (' + parameter.in + ')'
  }).join(', ') + ']'
}

export function renderEndpoints(swagger: Swagger) {
  var base = swagger.basePath || ''
  var groups: Record<string, Array<{sort: string, line: string}>> = {}

  Object.keys(swagger.paths).forEach(function(route) {
    var item = swagger.paths[route]!
    methods.forEach(function(method) {
      var operation = item[method] as SwaggerOperation | undefined
      if (!operation) {
        return
      }
      var tags = operation.tags || []
      var group = tags.find(function(tag) {
        return tag !== 'admin'
      }) || tags[0] || 'other'
      var line = '- `' + method.toUpperCase() + ' ' + base + route + '`' +
        (operation.summary ? ' - ' + operation.summary : '') +
        (tags.includes('admin') ? ' (admin)' : '') +
        describeParameters(operation)
      ;(groups[group] = groups[group] || []).push({
        sort: route + ' ' + methods.indexOf(method)
      , line: line
      })
    })
  })

  return Object.keys(groups).sort().map(function(group) {
    return '### ' + group + '\n\n' + groups[group]!.sort(function(a, b) {
      return Number(a.sort > b.sort) - Number(a.sort < b.sort)
    }).map(function(entry) {
      return entry.line
    }).join('\n') + '\n'
  }).join('\n')
}

export function render(template: string, swagger: Swagger, urls: GuideUrls) {
  var values: Record<string, string> = {
    APP_URL: urls.appUrl
  , API_URL: urls.apiUrl
  , WEBSOCKET_URL: urls.websocketUrl
  , AUTH_URL: urls.authUrl
  , ENDPOINTS: renderEndpoints(swagger)
  }
  return template.replace(/\{\{([A-Z_]+)\}\}/g, function(match, key: string) {
    return values[key] ?? match
  })
}

export function loadSwagger(): Swagger {
  var require = createRequire(import.meta.url)
  var runnerRequire = createRequire(require.resolve('autodesk-forks-swagger-node-runner'))
  var yaml = runnerRequire('js-yaml') as {load(source: string): unknown}
  var file = path.resolve(import.meta.dirname, '../units/api/swagger/api_v1.yaml')
  // eslint-disable-next-line no-sync
  return yaml.load(fs.readFileSync(file, 'utf8')) as Swagger
}

export function renderGuide(urls: GuideUrls) {
  // eslint-disable-next-line no-sync
  var template = fs.readFileSync(pathutil.resource('agents.md'), 'utf8')
  return render(template, loadSwagger(), urls)
}
