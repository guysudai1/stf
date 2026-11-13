import {spawn} from 'node:child_process'
import path from 'node:path'
import {REPO, BASE} from './harness.mjs'

export const cliPath = path.join(REPO, 'lib/cli/index.js')

export function runCli(args, {env = {}, timeout = 30000} = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('STF_')))
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], {env: {...clean, ...env}})
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => stdout += d)
    child.stderr.on('data', d => stderr += d)
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      resolve({code, signal, stdout, stderr})
    })
  })
}

export async function withToken(session, fn) {
  const res = await session.api('POST', `/user/accessTokens?title=parity-${Date.now()}`)
  if (res.status !== 201) throw new Error(`token create failed ${res.status} ${res.text}`)
  const {id} = res.json.token
  try {
    return await fn(id)
  }
  finally {
    await session.api('DELETE', `/user/accessTokens/${id}`).catch(() => {})
  }
}

export const shellAll = (token, args, opts) =>
  runCli(['shell-all', '--url', BASE, '--token', token, ...args], opts)
