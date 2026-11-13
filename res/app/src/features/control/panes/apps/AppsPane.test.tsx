import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import type {Control} from '@/core/control'
import type {Device} from '@/core/devices/types'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import AppsPane from './AppsPane'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})
  , gettext: (text: string) => text, translate: (text: string) => text}))

const SEPARATOR = '=====STF-PACKAGES====='
const listing = [
  'package:/data/app/b/base.apk=com.beta uid:10002'
  , 'package:/data/app/a/base.apk=com.alpha uid:10001'
  , 'package:/data/app/g/base.apk=org.Gamma uid:10003'
  , SEPARATOR
  , '  Package [com.beta] (1):'
  , '    versionCode=20 targetSdk=34'
  , '    versionName=2.0'
  , '  Package [com.alpha] (2):'
  , '    versionCode=3 targetSdk=33'
  , '    versionName=1.0'
  , '  Package [org.Gamma] (3):'
  , '    versionCode=100 targetSdk=35'
].join('\n')

let shell: ReturnType<typeof vi.fn>
let client: QueryClient
let serialCounter = 0
let serial: string

function setup() {
  const control = {shell} as unknown as Control
  return render(
    <QueryClientProvider client={client}>
      <AuthProviders><AppsPane device={{serial} as Device} control={control} /></AuthProviders>
    </QueryClientProvider>
  )
}

function names(): string[] {
  return screen.getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0]?.textContent ?? '')
}

function header(title: string): HTMLElement {
  return screen.getByRole('columnheader', {name: title})
}

beforeEach(() => {
  client = new QueryClient({defaultOptions: {queries: {staleTime: 30_000}}})
  serial = `serial-${++serialCounter}`
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: false
    , addEventListener: vi.fn(), removeEventListener: vi.fn()}))
  shell = vi.fn().mockResolvedValue({data: [listing]})
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.unstubAllGlobals()
})

describe('Apps pane', () => {
  it('renders rows from the shell result, sorted by name', async() => {
    setup()
    await screen.findByText('com.alpha')
    expect(names()).toEqual(['com.alpha', 'com.beta', 'org.Gamma'])
    const row = screen.getAllByRole('row')[2] as HTMLElement
    expect(within(row).getByText('2.0')).toBeTruthy()
    expect(within(row).getByText('20')).toBeTruthy()
    expect(within(row).getByText('34')).toBeTruthy()
    expect(screen.getByText('com.beta').getAttribute('title')).toBe('/data/app/b/base.apk')
  })

  it('filters by name case-insensitively and counts the filtered rows', async() => {
    setup()
    await screen.findByText('com.alpha')
    expect(screen.getByLabelText('Matching apps').textContent).toBe('3')
    fireEvent.change(screen.getByPlaceholderText('Filter packages'), {target: {value: 'GAMMA'}})
    expect(names()).toEqual(['org.Gamma'])
    expect(screen.getByLabelText('Matching apps').textContent).toBe('1')
  })

  it('toggles sort direction on the same header and resets on another', async() => {
    setup()
    await screen.findByText('com.alpha')
    fireEvent.click(header('Code'))
    expect(names()).toEqual(['com.alpha', 'com.beta', 'org.Gamma'])
    expect(header('Code').getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(header('Code'))
    expect(names()).toEqual(['org.Gamma', 'com.beta', 'com.alpha'])
    expect(header('Code').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(header('Version'))
    expect(header('Version').getAttribute('aria-sort')).toBe('ascending')
    expect(header('Code').getAttribute('aria-sort')).toBe('none')
  })

  it('reloads with a different command when system apps are toggled', async() => {
    setup()
    await screen.findByText('com.alpha')
    expect(shell).toHaveBeenCalledTimes(1)
    expect(shell.mock.calls[0]?.[0]).toContain('pm list packages -f -U -3;')
    fireEvent.click(screen.getByLabelText('Include system apps'))
    await waitFor(() => expect(shell).toHaveBeenCalledTimes(2))
    expect(shell.mock.calls[1]?.[0]).toContain('pm list packages -f -U;')
  })

  it('shows MD5 pending, the first token, and unavailable', async() => {
    setup()
    await screen.findByText('com.alpha')
    let resolve!: (value: unknown) => void
    shell.mockReturnValueOnce(new Promise(r => {
      resolve = r
    }))
    shell.mockRejectedValueOnce(new Error('boom'))
    const buttons = screen.getAllByRole('button', {name: 'Get MD5'})
    fireEvent.click(buttons[0] as HTMLElement)
    expect(shell).toHaveBeenLastCalledWith('md5sum \'/data/app/a/base.apk\'')
    expect(screen.getByText('…')).toBeTruthy()
    expect(screen.getAllByRole('button', {name: 'Get MD5'})).toHaveLength(2)
    await act(async() => resolve({data: ['abc123  /data/app/a/base.apk\n']}))
    expect(screen.getByText('abc123')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', {name: 'Get MD5'})[0] as HTMLElement)
    await screen.findByText('unavailable')
  })

  it('shows an error and keeps the previous rows', async() => {
    setup()
    await screen.findByText('com.alpha')
    shell.mockRejectedValueOnce(new Error('shell failed'))
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}))
    await screen.findByText('shell failed')
    expect(names()).toEqual(['com.alpha', 'com.beta', 'org.Gamma'])
  })

  it('does not sort when a column resize ends, and only that click is ignored', async() => {
    setup()
    await screen.findByText('com.alpha')
    const target = header('Code')
    fireEvent.mouseDown(screen.getByTestId('resize-versionCode'), {clientX: 0})
    fireEvent.mouseMove(document, {clientX: 30})
    fireEvent.mouseUp(document)
    fireEvent.click(target)
    expect(target.getAttribute('aria-sort')).toBe('none')
    expect(target.style.width).toBe('130px')
    await act(() => new Promise(r => setTimeout(r, 5)))
    fireEvent.click(target)
    expect(target.getAttribute('aria-sort')).toBe('ascending')
  })

  it('enforces a minimum column width', async() => {
    setup()
    await screen.findByText('com.alpha')
    fireEvent.mouseDown(screen.getByTestId('resize-versionCode'), {clientX: 500})
    fireEvent.mouseMove(document, {clientX: 0})
    fireEvent.mouseUp(document)
    expect(header('Code').style.width).toBe('40px')
  })

  it('a drag released outside the header does not swallow a later click', async() => {
    setup()
    await screen.findByText('com.alpha')
    fireEvent.mouseDown(screen.getByTestId('resize-versionCode'), {clientX: 0})
    fireEvent.mouseUp(document.body)
    await act(() => new Promise(r => setTimeout(r, 5)))
    fireEvent.click(header('Code'))
    expect(header('Code').getAttribute('aria-sort')).toBe('ascending')
  })

  it('shows cached rows instantly on remount and refreshes them in the background', async() => {
    const view = setup()
    await screen.findByText('com.alpha')
    view.unmount()
    let resolve!: (value: unknown) => void
    shell.mockReturnValueOnce(new Promise(r => {
      resolve = r
    }))
    setup()
    expect(names()).toEqual(['com.alpha', 'com.beta', 'org.Gamma'])
    await waitFor(() => expect(shell).toHaveBeenCalledTimes(2))
    await act(async() => resolve({data: [listing.replace('com.alpha', 'com.delta')]}))
    await screen.findByText('com.delta')
  })

  it('refetches when refresh is clicked', async() => {
    setup()
    await screen.findByText('com.alpha')
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}))
    await waitFor(() => expect(shell).toHaveBeenCalledTimes(2))
  })

  it('keeps a separate cached list for system apps', async() => {
    setup()
    await screen.findByText('com.alpha')
    fireEvent.click(screen.getByLabelText('Include system apps'))
    await waitFor(() => expect(shell).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh'}).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByLabelText('Include system apps'))
    expect(names()).toEqual(['com.alpha', 'com.beta', 'org.Gamma'])
  })

  it('keeps MD5 across a refetch and drops it when the version code changes', async() => {
    setup()
    await screen.findByText('com.alpha')
    shell.mockResolvedValueOnce({data: ['abc123  /data/app/a/base.apk\n']})
    fireEvent.click(screen.getAllByRole('button', {name: 'Get MD5'})[0] as HTMLElement)
    await screen.findByText('abc123')
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}))
    await waitFor(() => expect(shell).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByRole('button', {name: 'Refresh'}).hasAttribute('disabled')).toBe(false))
    expect(screen.getByText('abc123')).toBeTruthy()
    shell.mockResolvedValueOnce({data: [listing.replace('versionCode=3 ', 'versionCode=4 ')]})
    fireEvent.click(screen.getByRole('button', {name: 'Refresh'}))
    await waitFor(() => expect(screen.queryByText('abc123')).toBeNull())
    expect(screen.getAllByRole('button', {name: 'Get MD5'})).toHaveLength(3)
  })

  it('shows when the list was last updated', async() => {
    setup()
    await screen.findByText('com.alpha')
    expect(screen.getByText('Updated just now')).toBeTruthy()
  })
})
