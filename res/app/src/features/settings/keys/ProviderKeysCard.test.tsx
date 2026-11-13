import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {AuthProviders} from '@/ui/AuthProviders'
import {api, ApiError} from '@/core/api'
import {appState} from '@/core/app-state'
import {openConfirm} from '@/ui/modals'
import {ProviderKeysCard, keyNameFromFile} from './ProviderKeysCard'

vi.mock('@/core/i18n', () => ({useTranslation: () => ({t: (text: string) => text})
  , gettext: (text: string) => text, translate: (text: string) => text}))
vi.mock('@/core/api', async(importOriginal) => ({
  ...await importOriginal<typeof import('@/core/api')>()
  , api: {get: vi.fn(), post: vi.fn(), delete: vi.fn()}
}))
vi.mock('@/ui/modals', async(importOriginal) => ({
  ...await importOriginal<typeof import('@/ui/modals')>()
  , openConfirm: vi.fn()
}))

const get = vi.mocked(api.get)
const post = vi.mocked(api.post)
const del = vi.mocked(api.delete)

const key = {name: 'laptop.adb_key', fingerprint: 'aa:bb', size: 1704
  , modified: '2026-01-05T14:07:09.000Z', loaded: true}

function renderCard() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  return render(
    <AuthProviders><QueryClientProvider client={client}><ProviderKeysCard /></QueryClientProvider></AuthProviders>
  )
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: false
    , addEventListener: vi.fn(), removeEventListener: vi.fn()}))
  appState.user.privilege = 'admin'
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('keyNameFromFile', () => {
  it('drops the suffix and sanitises', () => {
    expect(keyNameFromFile('my key.adb_key')).toBe('my_key')
    expect(keyNameFromFile('a b.pem')).toBe('a_b.pem')
  })
})

describe('ProviderKeysCard', () => {
  it('renders nothing and does not load for non-admins', () => {
    appState.user.privilege = 'user'
    renderCard()
    expect(screen.queryByText('Provider ADB Keys')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('shows only the hint when not configured', async() => {
    get.mockResolvedValue({configured: false, keys: []})
    renderCard()
    await screen.findByText(/Not configured: start STF with --adb-keys-dir/)
    expect(screen.queryByText('Add key')).toBeNull()
  })

  it('lists keys and flags ignored ones', async() => {
    get.mockResolvedValue({configured: true, keys: [key
      , {...key, name: 'notes.txt', fingerprint: null, loaded: false}]})
    renderCard()
    await screen.findByText('laptop.adb_key')
    expect(screen.getByText('aa:bb')).toBeTruthy()
    expect(screen.getByText('ignored by adb')).toBeTruthy()
    expect(screen.getAllByText('-').length).toBe(1)
  })

  it('shows the empty state', async() => {
    get.mockResolvedValue({configured: true, keys: []})
    renderCard()
    await screen.findByText('No provider ADB keys')
  })

  it('autofills the name from the file, adds, and resets the form even on failure', async() => {
    get.mockResolvedValue({configured: true, keys: []})
    post.mockRejectedValue(new ApiError(409, 'Conflict', {description: 'Conflict: a key with this name already exists'}))
    const {container} = renderCard()
    await screen.findByText('No provider ADB keys')
    const add = screen.getByRole('button', {name: 'Add key'}) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, {target: {files: [new File(['PEM'], 'my key.adb_key')]}})
    const name = screen.getByPlaceholderText('Key name') as HTMLInputElement
    await waitFor(() => expect(name.value).toBe('my_key'))
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/adbkeys', {name: 'my_key', key: 'PEM'}))
    await screen.findByText('Conflict: a key with this name already exists')
    expect(name.value).toBe('')
    expect(add.disabled).toBe(true)
  })

  it('deletes after confirmation', async() => {
    get.mockResolvedValue({configured: true, keys: [key]})
    del.mockResolvedValue({})
    vi.mocked(openConfirm).mockResolvedValue(true)
    renderCard()
    fireEvent.click(await screen.findByRole('button', {name: 'Delete'}))
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/v1/adbkeys/laptop.adb_key'))
    expect(openConfirm).toHaveBeenCalledWith(expect.objectContaining({title: 'Delete this ADB key?', message: 'laptop.adb_key'}))
  })

  it('does not delete when declined', async() => {
    get.mockResolvedValue({configured: true, keys: [key]})
    vi.mocked(openConfirm).mockResolvedValue(false)
    renderCard()
    fireEvent.click(await screen.findByRole('button', {name: 'Delete'}))
    await waitFor(() => expect(openConfirm).toHaveBeenCalled())
    expect(del).not.toHaveBeenCalled()
  })
})
