import {Fragment, useState, type ReactNode} from 'react'
import {closestCenter, DndContext, DragOverlay, type DragEndEvent} from '@dnd-kit/core'
import {rectSortingStrategy, SortableContext, useSortable} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import {ActionIcon, Badge, Group, Paper, Text} from '@mantine/core'
import {IconGripVertical, IconRestore, IconX} from '@tabler/icons-react'
import {useTranslation} from '@/core/i18n'
import {blockTitle} from './catalog'
import {arrange, emptyList, reorderItem, toggleItem} from './layout'
import {useControlLayout, useEditing, useLayoutSensors} from './use-layout'
import classes from './Layout.module.css'

function SortableBlock({id, title, onHide, children}: {
  id: string
  title: string
  onHide: () => void
  children: ReactNode
}) {
  const {t} = useTranslation()
  const {attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging} =
    useSortable({id})
  return (
    <div
      ref={setNodeRef}
      className={`${classes.block} ${isDragging ? classes.placeholder : ''}`}
      style={{transform: CSS.Translate.toString(transform), transition}}
    >
      <Paper shadow='xs' radius='xl' withBorder className={classes.pill}>
        <Group gap={2} wrap='nowrap'>
          <ActionIcon
            ref={setActivatorNodeRef}
            variant='subtle'
            color='gray'
            size='sm'
            radius='xl'
            className={classes.handle}
            aria-label={`${t('Drag to reorder')}: ${title}`}
            {...attributes}
            {...listeners}
          >
            <IconGripVertical size={16} />
          </ActionIcon>
          <ActionIcon
            variant='subtle'
            color='gray'
            size='sm'
            radius='xl'
            aria-label={`${t('Hide')} ${title}`}
            onClick={onHide}
          >
            <IconX size={16} />
          </ActionIcon>
        </Group>
      </Paper>
      <div className={classes.inert} inert>{children}</div>
    </div>
  )
}

export function ArrangedBlocks({paneId, blocks, children}: {
  paneId: string
  blocks: {id: string, node: ReactNode}[]
  children: (nodes: ReactNode[]) => ReactNode
}) {
  const {t} = useTranslation()
  const editing = useEditing()
  const sensors = useLayoutSensors()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [layout, setLayout] = useControlLayout()
  const list = layout.blocks[paneId] ?? emptyList
  const ids = blocks.map((block) => block.id)
  const byId = new Map(blocks.map((block) => [block.id, block.node]))
  const items = arrange(ids, list)
  const visible = items.filter((item) => !item.hidden)
  const hidden = items.filter((item) => item.hidden)
  const title = (id: string) => t(blockTitle(paneId, id) ?? id)
  const save = (next: typeof list) => setLayout({...layout, blocks: {...layout.blocks, [paneId]: next}})

  if (!editing) {
    return children(visible.map((item) => <Fragment key={item.id}>{byId.get(item.id)}</Fragment>))
  }

  function onDragEnd({active, over}: DragEndEvent) {
    setActiveId(null)
    if (over) {
      save(reorderItem(ids, list, String(active.id), String(over.id)))
    }
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({active}) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={visible.map((item) => item.id)} strategy={rectSortingStrategy}>
          {children(visible.map((item) => (
            <SortableBlock
              key={item.id}
              id={item.id}
              title={title(item.id)}
              onHide={() => save(toggleItem(ids, list, item.id))}
            >
              {byId.get(item.id)}
            </SortableBlock>
          )))}
        </SortableContext>
        <DragOverlay>
          {activeId && (
            <Paper shadow='md' radius='md' withBorder className={classes.ghost}>
              <Text size='sm' fw={600}>{title(activeId)}</Text>
            </Paper>
          )}
        </DragOverlay>
      </DndContext>
      {hidden.length > 0 && (
        <Group gap='xs' className={classes.tray} aria-label={t('Hidden blocks')} role='group'>
          <Text size='sm' fw={600} c='dimmed'>{t('Hidden blocks')}</Text>
          {hidden.map((item) => (
            <Badge
              key={item.id}
              variant='default'
              size='lg'
              tt='none'
              rightSection={
                <ActionIcon
                  variant='transparent'
                  color='gray'
                  size='xs'
                  aria-label={`${t('Restore')} ${title(item.id)}`}
                  onClick={() => save(toggleItem(ids, list, item.id))}
                >
                  <IconRestore size={14} />
                </ActionIcon>
              }
            >
              {title(item.id)}
            </Badge>
          ))}
        </Group>
      )}
    </>
  )
}
