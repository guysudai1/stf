import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import {ApiError} from '@/core/api'
import {devicesApi} from '@/core/devices-api'
import {ShellAllCard} from './ShellAllCard'
import {shellAllCsv} from './shell-all'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})
  , gettext: (text: string) => text, translate: (text: string) => text}))
beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: false
  , addEventListener: vi.fn(), removeEventListener: vi.fn()})))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderCard() {
  render(<AuthProviders><ShellAllCard /></AuthProviders>)
}

function type(text: string) {
  fireEvent.change(screen.getByPlaceholderText('e.g. getprop ro.product.model'), {target: {value: text}})
}

const response = {
  description: 'Shell command completed'
  , results: [
    {serial: 'a', success: true, data: 'out a'}
    , {serial: 'b', success: false, data: '', error: 'boom'}
    , {serial: 'c', success: null, data: ''}
  ]
  , skipped: [{serial: 'd', reason: 'in use by Bob'}]
}

describe('ShellAllCard', () => {
  it('disables Run until a command is typed', () => {
    renderCard()
    const run = screen.getByRole('button', {name: 'Run'}) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    type('id')
    expect(run.disabled).toBe(false)
  })

  it('posts the command and force flag and lists results and skipped', async() => {
    const runShell = vi.spyOn(devicesApi, 'runShell').mockResolvedValue(response)
    renderCard()
    type('id')
    fireEvent.click(screen.getByLabelText('Include devices in use'))
    fireEvent.click(screen.getByRole('button', {name: 'Run'}))
    await screen.findByText('Shell command completed')
    expect(runShell).toHaveBeenCalledWith('id', true)
    expect(screen.getByText('out a')).toBeTruthy()
    expect(screen.getByText('boom')).toBeTruthy()
    expect(screen.getByText('ok')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('timed out')).toBeTruthy()
    expect(screen.getByText('skipped: in use by Bob')).toBeTruthy()
    expect(screen.getByRole('button', {name: 'Export CSV'})).toBeTruthy()
  })

  it('shows the server description on error, without export', async() => {
    vi.spyOn(devicesApi, 'runShell').mockRejectedValue(new ApiError(403, 'Forbidden', {description: 'Forbidden'}))
    renderCard()
    type('id')
    fireEvent.click(screen.getByRole('button', {name: 'Run'}))
    await screen.findByText('Forbidden')
    expect(screen.queryByRole('button', {name: 'Export CSV'})).toBeNull()
  })

  it('falls back to "Request failed"', async() => {
    vi.spyOn(devicesApi, 'runShell').mockRejectedValue(new Error('network'))
    renderCard()
    type('id')
    fireEvent.click(screen.getByRole('button', {name: 'Run'}))
    await waitFor(() => expect(screen.getByText('Request failed')).toBeTruthy())
  })
})

describe('shellAllCsv', () => {
  it('quotes every cell, uses CRLF, and puts skipped last', () => {
    const csv = shellAllCsv({
      ...response
      , command: 'echo "x"'
      , results: [{serial: 'a', success: true, data: 'l1\nl2'}, {serial: 'b', success: false, error: 'boom'}
        , {serial: 'c', success: null}]
    })
    expect(csv).toBe([
      '"command","serial","status","output"'
      , '"echo ""x""","a","ok","l1\nl2"'
      , '"echo ""x""","b","failed","boom"'
      , '"echo ""x""","c","timed out",""'
      , '"echo ""x""","d","skipped","in use by Bob"'
    ].join('\r\n'))
  })
})
