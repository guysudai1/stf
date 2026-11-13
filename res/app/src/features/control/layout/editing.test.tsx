import {act, useState} from 'react'
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {Tabs} from '@mantine/core'
import {IconBolt, IconGauge, IconInfoCircle} from '@tabler/icons-react'
import {AuthProviders} from '@/ui/AuthProviders'
import {ArrangedBlocks} from './ArrangedBlocks'
import {LayoutTabBar} from './TabBar'
import {arrange} from './layout'
import {EditingProvider, useControlLayout} from './use-layout'

const state = vi.hoisted(() => ({
  stored: null as unknown, set: vi.fn(), confirm: vi.fn(), listeners: new Set<() => void>()
}))
vi.mock('@/core/i18n', () => ({
  useTranslation: () => ({
    t: (text: string, params?: {count: number}) => text.replace('{{count}}', String(params?.count))
  })
  , gettext: (text: string) => text
  , translate: (text: string) => text
}))
vi.mock('@/core/settings', async() => {
  const {useSyncExternalStore} = await import('react')
  return {
    useSetting: () => [
      useSyncExternalStore((listener) => {
        state.listeners.add(listener)
        return () => state.listeners.delete(listener)
      }, () => state.stored)
      , (next: unknown) => {
        state.stored = next
        state.set(next)
        state.listeners.forEach((listener) => listener())
      }
    ]
  }
})
vi.mock('@/ui/modals', () => ({openConfirm: state.confirm}))

const panes = [
  {id: 'dashboard', title: 'Dashboard', icon: IconGauge}
  , {id: 'advanced', title: 'Advanced', icon: IconBolt}
  , {id: 'info', title: 'Info', icon: IconInfoCircle}
]

function Harness() {
  const [editing, setEditing] = useState(false)
  return (
    <AuthProviders>
      <EditingProvider value={editing}>
        <Tabs value='dashboard'>
          <TabBarWithLayout editing={editing} setEditing={setEditing} />
          <ArrangedBlocks
            paneId='dashboard'
            blocks={[
              {id: 'clipboard', node: <div>clipboard body</div>}
              , {id: 'install', node: <div>install body</div>}
            ]}
          >
            {(nodes) => <div data-testid='grid'>{nodes}</div>}
          </ArrangedBlocks>
        </Tabs>
      </EditingProvider>
    </AuthProviders>
  )
}

function TabBarWithLayout({editing, setEditing}: {editing: boolean, setEditing: (value: boolean) => void}) {
  const [layout] = useControlLayout()
  const ids = arrange(panes.map((pane) => pane.id), layout.panes, true).filter((item) => !item.hidden)
    .map((item) => item.id)
  return (
    <LayoutTabBar
      available={panes}
      visible={ids.map((id) => panes.find((pane) => pane.id === id)!)}
      readOnly={false}
      editing={editing}
      onEdit={() => setEditing(true)}
      onDone={() => setEditing(false)}
    />
  )
}

function tabNames() {
  return screen.getAllByRole('tab').map((tab) => tab.textContent)
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({matches: false
    , addEventListener: vi.fn(), removeEventListener: vi.fn()}))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  state.stored = null
  state.set.mockClear()
  state.confirm.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('on-page layout editing', () => {
  it('enters and leaves edit mode with Done and Escape', () => {
    render(<Harness />)
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.queryByLabelText('Hide Dashboard')).toBeNull()
    fireEvent.click(screen.getByLabelText('Customize layout'))
    expect(screen.getByText('Done')).toBeTruthy()
    expect(screen.getByLabelText('Drag to reorder: Dashboard')).toBeTruthy()
    expect(screen.getByLabelText('Drag to reorder: Clipboard')).toBeTruthy()
    fireEvent.click(screen.getByText('Done'))
    expect(screen.queryByText('Done')).toBeNull()
    fireEvent.click(screen.getByLabelText('Customize layout'))
    fireEvent.keyDown(window, {key: 'Escape'})
    expect(screen.queryByText('Done')).toBeNull()
  })

  it('hides and restores a tab, saving immediately', async() => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Customize layout'))
    fireEvent.click(screen.getByLabelText('Hide Advanced'))
    expect(tabNames()).toEqual(['Dashboard', 'Info'])
    expect(state.set).toHaveBeenLastCalledWith({
      panes: {order: [], hidden: ['advanced']}, blocks: {}
    })
    fireEvent.click(screen.getByText('+1 hidden'))
    fireEvent.click(await screen.findByLabelText('Restore Advanced'))
    expect(tabNames()).toEqual(['Dashboard', 'Advanced', 'Info'])
  })

  it('does not allow hiding the last visible tab', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Customize layout'))
    fireEvent.click(screen.getByLabelText('Hide Advanced'))
    fireEvent.click(screen.getByLabelText('Hide Info'))
    expect(tabNames()).toEqual(['Dashboard'])
    expect((screen.getByLabelText('Hide Dashboard') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides a block into the tray and restores it', () => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Customize layout'))
    fireEvent.click(screen.getByLabelText('Hide Clipboard'))
    expect(screen.queryByText('clipboard body')).toBeNull()
    const tray = screen.getByRole('group', {name: 'Hidden blocks'})
    fireEvent.click(within(tray).getByLabelText('Restore Clipboard'))
    expect(screen.getByText('clipboard body')).toBeTruthy()
    expect(screen.queryByRole('group', {name: 'Hidden blocks'})).toBeNull()
  })

  it('does not show hidden blocks outside edit mode', () => {
    state.stored = {panes: {order: [], hidden: []}, blocks: {dashboard: {order: [], hidden: ['install']}}}
    render(<Harness />)
    expect(screen.queryByText('install body')).toBeNull()
    fireEvent.click(screen.getByLabelText('Customize layout'))
    expect(screen.getByLabelText('Restore App Upload')).toBeTruthy()
    fireEvent.click(screen.getByText('Done'))
    expect(screen.queryByLabelText('Restore App Upload')).toBeNull()
  })

  it('resets after confirmation only', async() => {
    state.stored = {panes: {order: [], hidden: ['advanced']}, blocks: {}}
    state.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Customize layout'))
    fireEvent.click(screen.getByText('Reset'))
    await waitFor(() => expect(state.confirm).toHaveBeenCalledTimes(1))
    expect(state.set).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Reset'))
    await waitFor(() => expect(state.set).toHaveBeenCalledWith(null))
    await waitFor(() => expect(tabNames()).toEqual(['Dashboard', 'Advanced', 'Info']))
  })

  it('reorders tabs with the keyboard sensor', async() => {
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Customize layout'))
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
      const index = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0
      return {x: index * 100, y: 0, left: index * 100, top: 0, right: index * 100 + 90, bottom: 30
        , width: 90, height: 30, toJSON: () => ({})}
    })
    const handle = screen.getByLabelText('Drag to reorder: Dashboard')
    handle.focus()
    const tick = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    fireEvent.keyDown(handle, {code: 'Space', key: ' '})
    await tick()
    fireEvent.keyDown(document, {code: 'ArrowRight', key: 'ArrowRight'})
    await tick()
    fireEvent.keyDown(document, {code: 'Space', key: ' '})
    await tick()
    await waitFor(() => expect(state.set).toHaveBeenCalled())
    expect(state.set.mock.calls.at(-1)![0].panes.order).toEqual(['advanced', 'dashboard', 'info'])
  })
})
