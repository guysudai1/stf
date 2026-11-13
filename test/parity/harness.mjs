import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.env.PARITY_TARGET || 'old'
if (!['old', 'new'].includes(target)) throw new Error('PARITY_TARGET must be old or new')

const repos = {
  old: process.env.PARITY_OLD_REPO || path.resolve(here, '../../../stf')
, new: path.resolve(here, '../..')
}
export const OLD_REPO = repos.old
export const REPO = repos[target]
const targets = {
  old: {base: 'http://127.0.0.1:7100', serial: 'emulator-5554'}
, new: {base: 'http://127.0.0.1:7200', serial: 'emulator-5556'}
}

export const TARGET = target
export const BASE = targets[target].base
export const SERIAL = targets[target].serial
export const isNew = target === 'new'

const require = createRequire(path.join(repos[target], 'package.json'))
const {io} = require('socket.io-client')

const sleep = ms => new Promise(r => setTimeout(r, ms))
export {sleep}

export class Jar {
  cookies = new Map()
  absorb(res) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';')
      const i = pair.indexOf('=')
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1))
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  get(name) {
    return this.cookies.get(name)
  }
}

export async function raw(jar, method, url, {body, headers = {}, auth} = {}) {
  const h = {Accept: 'application/json'}
  const cookie = jar?.header()
  if (cookie) h.Cookie = cookie
  if (body !== undefined) h['Content-Type'] = 'application/json'
  const xsrf = jar?.get('XSRF-TOKEN')
  if (xsrf && method !== 'GET') h['X-XSRF-TOKEN'] = xsrf
  Object.assign(h, headers)
  if (auth) h.Authorization = `Bearer ${auth}`
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method
  , headers: h
  , body: body === undefined ? undefined : JSON.stringify(body)
  , redirect: 'manual'
  })
  jar?.absorb(res)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  }
  catch {
    json = undefined
  }
  if (method === 'POST' && res.status === 200 && url.startsWith('/auth/api/v1/')) recordAuth(jar, url, body)
  return {status: res.status, headers: res.headers, text, json}
}

function recordAuth(jar, url, body) {
  if (url.endsWith('/guest')) {
    const ssid = jar?.get('ssid')
    if (ssid) recordUser(`${cookieJson(ssid).guestId}@guest.local`)
  }
  else if (url.endsWith('/mock') && body?.email) recordUser(body.email)
}

export const guestAvailable = async () => (await raw(null, 'GET', '/auth/guest/')).status === 200

export async function authPost(jar, nickname, {email} = {}) {
  const guest = await guestAvailable()
  if (guest) {
    await raw(jar, 'GET', '/auth/guest/')
    return {guest, res: await raw(jar, 'POST', '/auth/api/v1/guest', {body: {name: nickname}})}
  }
  await raw(jar, 'GET', '/auth/mock/')
  const mail = email || `${nickname.toLowerCase().replace(/\W+/g, '-')}@parity.test`
  return {guest, res: await raw(jar, 'POST', '/auth/api/v1/mock', {body: {name: nickname, email: mail}})}
}

const created = new Set()
const usersFile = () => process.env.PARITY_USERS_FILE

export function recordUser(email) {
  if (!email || created.has(email)) return
  created.add(email)
  if (usersFile()) fs.appendFileSync(usersFile(), email + '\n')
}

export const recordedUsers = () => usersFile() && fs.existsSync(usersFile()) ?
  fs.readFileSync(usersFile(), 'utf8').split('\n').filter(Boolean) : [...created]

const janitorFile = path.join(os.tmpdir(), `stf-parity-janitor-${target}.txt`)

// Deletes exactly the given emails (all created by this run), releasing any device they hold.
// A user cannot delete itself, so the janitor's own user is deleted by a second janitor whose
// email is remembered and removed by the next run.
export async function purgeUsers(emails) {
  emails = [...new Set(emails)].filter(Boolean)
  if (!emails.length) return
  const previous = fs.existsSync(janitorFile) ? fs.readFileSync(janitorFile, 'utf8').trim() : ''
  if (previous) emails.push(previous)
  const bulk = async (session, list) => {
    const res = await session.api('DELETE', '/users', {emails: list.join(',')})
    if (![200, 403, 404].includes(res.status)) console.error(`parity cleanup: ${res.status} ${res.text}`)
  }
  const janitor = await loginRaw(uniq('janitor'))
  try {
    const devices = await janitor.get('/devices?fields=serial,owner.email')
    for (const d of devices.json?.devices ?? []) {
      if (d.owner?.email && emails.includes(d.owner.email)) await janitor.stop(d.serial)
    }
    await bulk(janitor, emails)
  }
  finally {
    const second = await loginRaw(uniq('janitor'))
    await bulk(second, [janitor.email])
    fs.writeFileSync(janitorFile, second.email)
  }
}

// beforeExit, not a node:test hook: a file's own `after` hooks may still create users
let purged = false
{
  process.on('beforeExit', async () => {
    if (purged || usersFile()) return
    purged = true
    await purgeUsers([...created]).catch(e => console.error('parity cleanup failed:', e))
  })
}

export async function login(name, opts) {
  const session = await loginRaw(name, opts)
  recordUser(session.email)
  return session
}

async function loginRaw(name, opts) {
  const jar = new Jar()
  const {guest, res} = await authPost(jar, name, opts)
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${res.text}`)
  const follow = await raw(jar, 'GET', res.json.redirect)
  if (follow.status !== 302) throw new Error(`jwt redirect failed ${follow.status}`)
  const me = await raw(jar, 'GET', '/api/v1/user')
  const session = new Session(jar, me.json.user, guest)
  return session
}

export class Session {
  held = new Set()
  sockets = new Set()

  constructor(jar, user, guest) {
    this.jar = jar
    this.user = user
    this.guest = guest
    this.email = user.email
  }

  api(method, url, body, extra) {
    return raw(this.jar, method, '/api/v1' + url, {body, ...extra})
  }
  get(url) {
    return this.api('GET', url)
  }

  async use(serial = SERIAL, body = {}) {
    const res = await this.api('POST', '/user/devices', {serial, ...body})
    if (res.status === 200) this.held.add(serial)
    return res
  }
  async stop(serial = SERIAL) {
    const res = await this.api('DELETE', `/user/devices/${serial}`)
    this.held.delete(serial)
    return res
  }

  async appState() {
    const res = await raw(this.jar, 'GET', '/app/api/v1/state.js')
    const m = /GLOBAL_APPSTATE = (.*)$/s.exec(res.text)
    return JSON.parse(m[1])
  }

  async socket() {
    const {config} = await this.appState()
    const url = new URL(config.websocketUrl)
    const socket = io(url.origin, {
      query: Object.fromEntries(url.searchParams)
    , transports: ['websocket']
    , extraHeaders: {Cookie: this.jar.header()}
    , reconnection: false
    , forceNew: true
    })
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
    })
    this.sockets.add(socket)
    return socket
  }

  async cleanup() {
    for (const s of this.sockets) s.close()
    this.sockets.clear()
    for (const serial of [...this.held]) await this.stop(serial).catch(() => {})
    await sleep(300)
  }
}

export function once(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms)
    socket.once(event, data => {
      clearTimeout(t)
      resolve(data)
    })
  })
}

export function quiet(socket, event, ms = 1000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(true), ms)
    socket.once(event, () => {
      clearTimeout(t)
      resolve(false)
    })
  })
}

export const uniq = p => `${p}-${Math.random().toString(36).slice(2, 8)}`

export async function releaseAll(sessions) {
  for (const s of sessions) await s.cleanup()
}

export async function withUsers(n, fn) {
  const sessions = []
  try {
    for (let i = 0; i < n; i++) sessions.push(await login(uniq('par' + i)))
    return await fn(...sessions)
  }
  finally {
    await releaseAll(sessions)
  }
}

const lockDir = path.join(os.tmpdir(), `stf-parity-${target}.lock`)

export async function lockDevice() {
  for (let i = 0; i < 600; i++) {
    try {
      fs.mkdirSync(lockDir)
      return
    }
    catch {
      const age = Date.now() - fs.statSync(lockDir, {throwIfNoEntry: false})?.mtimeMs
      if (age > 120000) fs.rmSync(lockDir, {recursive: true, force: true})
      await sleep(500)
    }
  }
  throw new Error('device lock timeout')
}

export function unlockDevice() {
  fs.rmSync(lockDir, {recursive: true, force: true})
}

export const jwtHeader = jwt => JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString())
export const cookieJson = value => JSON.parse(Buffer.from(decodeURIComponent(value), 'base64').toString())
