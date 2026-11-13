import {useEffect, type ComponentType} from 'react'
import {closestCenter, DndContext, type DragEndEvent} from '@dnd-kit/core'
import {horizontalListSortingStrategy, SortableContext, useSortable} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {ActionIcon, Button, Group, Menu, Tabs, Text, Tooltip} from '@mantine/core'
import {IconEyeOff, IconPencil, IconX} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {openConfirm} from '@/ui/modals'
import {arrange, reorderItem, toggleItem} from './layout'
import {useControlLayout, useLayoutSensors} from './use-layout'
import classes from './Layout.module.css'

interface TabPane {
  id: string
  title: string
  icon: ComponentType<{size?: number}>
}

function EditableTab({pane, disabled, canHide, onHide}: {
  pane: TabPane
  disabled: boolean
  canHide: boolean
  onHide: () => void
}) {
  const {t} = useTranslation()
  const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} =
    useSortable({id: pane.id})
  const title = t(pane.title)
  const {role: _role, tabIndex: _tabIndex, ...dragAttributes} = attributes
  return (
    <div
      ref={setNodeRef}
      className={`${classes.sortableTab} ${isDragging ? classes.dragging : ''}`}
      style={{transform: CSS.Translate.toString(transform), transition}}
    >
      <Tabs.Tab
        ref={setActivatorNodeRef}
        value={pane.id}
        disabled={disabled}
        className={classes.grab}
        leftSection={<pane.icon size={16} />}
        aria-label={`${t('Drag to reorder')}: ${title}`}
        {...dragAttributes}
        {...listeners}
      >
        {title}
      </Tabs.Tab>
      <ActionIcon
        variant='subtle'
        color='gray'
        size='xs'
        disabled={!canHide}
        aria-label={`${t('Hide')} ${title}`}
        onClick={onHide}
      >
        <IconX size={14} />
      </ActionIcon>
    </div>
  )
}

export function LayoutTabBar({available, visible, readOnly, editing, onEdit, onDone}: {
  available: TabPane[]
  visible: TabPane[]
  readOnly: boolean
  editing: boolean
  onEdit: () => void
  onDone: () => void
}) {
  const {t} = useTranslation()
  const sensors = useLayoutSensors()
  const [layout, setLayout] = useControlLayout()
  const ids = available.map((pane) => pane.id)
  const hidden = arrange(ids, layout.panes, true).filter((item) => item.hidden)
  const save = (panes: typeof layout.panes) => setLayout({...layout, panes})
  const isDisabled = (id: string) => readOnly && id !== 'info'

  useEffect(() => {
    if (!editing) {
      return
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented &&
          !document.querySelector('[role="dialog"], [role="menu"]')) {
        onDone()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onDone])

  async function reset() {
    const confirmed = await openConfirm({
      title: t('Reset layout')
      , message: t('Restore the default tabs and blocks?')
      , confirmLabel: t('Reset layout')
      , danger: true
    })
    if (confirmed) {
      setLayout(null)
    }
  }

  function onDragEnd({active, over}: DragEndEvent) {
    if (over) {
      save(reorderItem(ids, layout.panes, String(active.id), String(over.id), true))
    }
  }

  return (
    <>
      <div className={classes.tabBar}>
        <Tabs.List className={classes.tabList}>
          {editing ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={visible.map((pane) => pane.id)} strategy={horizontalListSortingStrategy}>
                {visible.map((pane) => (
                  <EditableTab
                    key={pane.id}
                    pane={pane}
                    disabled={isDisabled(pane.id)}
                    canHide={visible.length > 1}
                    onHide={() => save(toggleItem(ids, layout.panes, pane.id, true))}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : visible.map(({id, title, icon: Icon}) => (
            <Tabs.Tab key={id} value={id} disabled={isDisabled(id)} leftSection={<Icon size={16} />}>
              {t(title)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {!editing && (
          <Tooltip label={t('Customize layout')}>
            <ActionIcon variant='subtle' aria-label={t('Customize layout')} onClick={onEdit} className={classes.pencil}>
              <IconPencil size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </div>
      {editing && (
        <Group justify='space-between' gap='xs' px='sm' py={6} className={classes.editBar}>
          <Text size='sm' c='dimmed'>{t('Editing layout — drag to reorder, × to hide')}</Text>
          <Group gap='xs' wrap='wrap'>
            {hidden.length > 0 && (
              <Menu position='bottom-end' withinPortal>
                <Menu.Target>
                  <Button variant='default' size='compact-sm' leftSection={<IconEyeOff size={14} />}>
                    {t('+{{count}} hidden', {count: hidden.length})}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {hidden.map(({id}) => {
                    const pane = available.find((candidate) => candidate.id === id) as TabPane
                    return (
                      <Menu.Item
                        key={id}
                        leftSection={<pane.icon size={16} />}
                        aria-label={`${t('Restore')} ${t(pane.title)}`}
                        onClick={() => save(toggleItem(ids, layout.panes, id, true))}
                      >
                        {t(pane.title)}
                      </Menu.Item>
                    )
                  })}
                </Menu.Dropdown>
              </Menu>
            )}
            <Button variant='subtle' size='compact-sm' onClick={reset}>{t('Reset')}</Button>
            <Button size='compact-sm' onClick={onDone}>{t('Done')}</Button>
          </Group>
        </Group>
      )}
    </>
  )
}
