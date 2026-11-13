import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {MemoryRouter, Route, Routes} from 'react-router'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import {appState} from '@/core/app-state'
import HealthLogsPage from './HealthLogsPage'
import {deviceOptions, healthApi, matchesLive, prependLive, withKeys, type HealthLog} from './health-logs'

type Handler = (...args: any[]) => void
const handlers = new Map<string, Handler>()

vi.mock('@/core/i18n', () => ({
  useTranslation: () => ({
    t: (text: string, params?: Record<string, unknown>) =>
      text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(params?.[name]))
  })
  , gettext: (text: string) => text
  , translate: (text: string) => text
}))
let mockDevices: Array<{serial: string, model?: string}> = []
vi.mock('@/core/devices/store', () => ({
  useDevices: () => ({devices: mockDevices, loading: false, error: null})
}))
vi.mock('@/core/socket', () => ({
  useSocketEvent: (event: string, handler: (...args: any[]) => void) => {
    handlers.set(event, handler)
  }
}))

function entry(extra: Partial<HealthLog> = {}): Omit<HealthLog, 'key'> {
  return {
    id: 'a'
    , timestamp: '2026-11-13T10:00:00.000Z'
    , priority: 6
    , tag: 'api'
    , pid: 1
    , message: 'Request failed\nError: boom'
    , identifier: 'x'
    , serial: null
    , kind: 'server'
    , severity: 'error'
    , levelLabel: 'Error'
    , messageSummary: 'Request failed'
    , details: 'Error: boom'
    , ...extra
  }
}

const summary = {
  status: 'critical' as const
  , statusDescription: 'Critical: fatal events were recorded in the last 24 hours.'
  , devices: {total: 2, present: 1, ready: 1}
  , logs: {total: 173, warning: 3, error: 14, fatal: 13}
}

function renderPage() {
  render(
    <AuthProviders>
      <MemoryRouter initialEntries={['/health-logs']}>
        <Routes>
          <Route path='/health-logs' element={<HealthLogsPage />} />
          <Route path='/devices' element={<div>devices page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProviders>
  )
}

beforeEach(() => {
  appState.user.privilege = 'admin'
  handlers.clear()
  mockDevices = []
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: false
    , addEventListener: vi.fn(), removeEventListener: vi.fn()}))
  vi.spyOn(healthApi, 'summary').mockResolvedValue({summary})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('HealthLogsPage', () => {
  it('shows the summary cards and the log rows', async() => {
    vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: [entry(), entry({id: 'b', serial: 'emu-1', details: ''})]})
    renderPage()
    expect(await screen.findByText('critical')).toBeTruthy()
    expect(screen.getByText('1 / 2 present')).toBeTruthy()
    expect(screen.getByText('173 events')).toBeTruthy()
    expect(screen.getByText('14 / 13')).toBeTruthy()
    expect((await screen.findAllByText('Request failed')).length).toBe(2)
    expect(screen.getByRole('button', {name: 'emu-1'})).toBeTruthy()
    expect(screen.getAllByText('Stack/details').length).toBe(1)
  })

  it('shows the unfiltered empty message', async() => {
    vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: []})
    renderPage()
    expect(await screen.findByText('No health events in the last 24 hours.')).toBeTruthy()
  })

  it('shows a no-match message instead when a filter is active', async() => {
    const logs = vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: []})
    renderPage()
    await screen.findByText('No health events in the last 24 hours.')
    fireEvent.change(screen.getByPlaceholderText('Search tag, source, or message'), {target: {value: 'zzz'}})
    await waitFor(() => expect(logs).toHaveBeenLastCalledWith({q: 'zzz', priority: '', serial: ''}))
    expect(await screen.findByText('No matching health events.')).toBeTruthy()
    expect(screen.queryByText('No health events in the last 24 hours.')).toBeNull()
  })

  it('reports load failures', async() => {
    vi.spyOn(healthApi, 'logs').mockRejectedValue(new Error('nope'))
    renderPage()
    expect(await screen.findByText('Unable to load health logs.')).toBeTruthy()
  })

  it('prepends live entries that match the filters', async() => {
    vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: [entry()]})
    renderPage()
    await screen.findByText('Request failed')
    act(() => handlers.get('health.log')!(entry({id: 'live', message: 'Live one', messageSummary: 'Live one', details: ''})))
    expect(await screen.findByText('Live one')).toBeTruthy()
  })

  it('filters by device from the select, using known devices and serials seen in rows', async() => {
    mockDevices = [{serial: 'emu-1', model: 'Pixel'}]
    const logs = vi.spyOn(healthApi, 'logs').mockResolvedValue({
      logs: [entry({id: 'a', serial: '10.0.0.5:5555', tag: 'device:connection:remote-connect-failed'})]
    })
    renderPage()
    await screen.findByText('Request failed')
    fireEvent.click(screen.getByPlaceholderText('All devices'))
    expect(await screen.findByText('Pixel \u2014 emu-1')).toBeTruthy()
    fireEvent.click(await screen.findByText('10.0.0.5:5555', {selector: '[role=option] span'}))
    await waitFor(() => expect(logs).toHaveBeenLastCalledWith({q: '', priority: '', serial: '10.0.0.5:5555'}))
  })

  it('sets the device filter when a serial chip is clicked', async() => {
    const logs = vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: [entry({serial: 'emu-1'})]})
    renderPage()
    fireEvent.click(await screen.findByRole('button', {name: 'emu-1'}))
    await waitFor(() => expect(logs).toHaveBeenLastCalledWith({q: '', priority: '', serial: 'emu-1'}))
  })

  it('keeps only live entries of the selected device', async() => {
    vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: [entry({serial: 'emu-1'})]})
    renderPage()
    fireEvent.click(await screen.findByRole('button', {name: 'emu-1'}))
    await waitFor(() => expect(healthApi.logs).toHaveBeenCalledTimes(2))
    await screen.findByText('Request failed')
    act(() => handlers.get('health.log')!(entry({id: 'o', serial: 'other', message: 'Other one', messageSummary: 'Other one', details: ''})))
    act(() => handlers.get('health.log')!(entry({id: 'm', serial: 'emu-1', message: 'Mine one', messageSummary: 'Mine one', details: ''})))
    expect(await screen.findByText('Mine one')).toBeTruthy()
    expect(screen.queryByText('Other one')).toBeNull()
  })

  it('refreshes summary and logs', async() => {
    const logs = vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: []})
    renderPage()
    await screen.findByText('critical')
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}))
    await waitFor(() => expect(logs).toHaveBeenCalledTimes(2))
    expect(healthApi.summary).toHaveBeenCalledTimes(2)
  })

  it('sends non-admins away without any request', () => {
    appState.user.privilege = 'user'
    const logs = vi.spyOn(healthApi, 'logs').mockResolvedValue({logs: []})
    renderPage()
    expect(screen.getByText('devices page')).toBeTruthy()
    expect(logs).not.toHaveBeenCalled()
    expect(healthApi.summary).not.toHaveBeenCalled()
  })
})

describe('live entry helpers', () => {
  const live = withKeys([entry({serial: 'emu-1', priority: 5})])[0]!

  it('matches the search on message, tag and serial, case-insensitively', () => {
    expect(matchesLive(live, {q: 'EMU-1', priority: '', serial: ''})).toBe(true)
    expect(matchesLive(live, {q: 'api', priority: '', serial: ''})).toBe(true)
    expect(matchesLive(live, {q: 'boom', priority: '', serial: ''})).toBe(true)
    expect(matchesLive(live, {q: 'nothing', priority: '', serial: ''})).toBe(false)
  })

  it('matches the search on identifier and the device filter exactly', () => {
    expect(matchesLive(live, {q: 'x', priority: '', serial: ''})).toBe(true)
    expect(matchesLive(live, {q: '', priority: '', serial: 'emu-1'})).toBe(true)
    expect(matchesLive(live, {q: '', priority: '', serial: 'emu'})).toBe(false)
  })

  it('builds device options from devices and row serials', () => {
    expect(deviceOptions(
      [{serial: 'b', model: 'Pixel'}, {serial: 'a'}]
      , [{serial: 'a'}, {serial: '1.2.3.4:5555'}, {serial: null}]
      , 'gone'
    )).toEqual([
      {value: '1.2.3.4:5555', label: '1.2.3.4:5555'}
      , {value: 'a', label: 'a'}
      , {value: 'gone', label: 'gone'}
      , {value: 'b', label: 'Pixel \u2014 b'}
    ])
  })

  it('applies the minimum level', () => {
    expect(matchesLive(live, {q: '', priority: '5', serial: ''})).toBe(true)
    expect(matchesLive(live, {q: '', priority: '6', serial: ''})).toBe(false)
  })

  it('keeps the newest 1000 entries', () => {
    const logs = Array.from({length: 1000}, (_v, i) => ({...live, key: `k${i}`}))
    const next = prependLive(logs, {...live, key: 'new'})
    expect(next.length).toBe(1000)
    expect(next[0]!.key).toBe('new')
  })
})
