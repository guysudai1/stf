export interface ListLayout {
  order: string[]
  hidden: string[]
}

export interface ControlLayout {
  panes: ListLayout
  blocks: Record<string, ListLayout>
}

export interface LayoutItem {
  id: string
  hidden: boolean
}

export const emptyList: ListLayout = {order: [], hidden: []}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeList(value: unknown): ListLayout {
  const list = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ListLayout, unknown>>
  return {order: strings(list.order), hidden: strings(list.hidden)}
}

export function normalizeLayout(value: unknown): ControlLayout {
  const layout = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const blocks = layout.blocks && typeof layout.blocks === 'object' ? layout.blocks : {}
  return {
    panes: normalizeList(layout.panes)
    , blocks: Object.fromEntries(
      Object.entries(blocks).map(([id, list]) => [id, normalizeList(list)])
    )
  }
}

function orderedIds(ids: string[], list: ListLayout): string[] {
  const result = [...new Set(list.order)].filter((id) => ids.includes(id))
  ids.forEach((id, index) => {
    if (!result.includes(id)) {
      const previous = ids.slice(0, index).reverse().find((candidate) => result.includes(candidate))
      result.splice(previous === undefined ? 0 : result.indexOf(previous) + 1, 0, id)
    }
  })
  return result
}

export function arrange(ids: string[], list: ListLayout, keepOne = false): LayoutItem[] {
  const items = orderedIds(ids, list).map((id) => ({id, hidden: list.hidden.includes(id)}))
  if (keepOne && items.length && items.every((item) => item.hidden)) {
    items[0] = {id: items[0]!.id, hidden: false}
  }
  return items
}

export function visibleIds(ids: string[], list: ListLayout, keepOne = false): string[] {
  return arrange(ids, list, keepOne).filter((item) => !item.hidden).map((item) => item.id)
}

export function toggleItem(ids: string[], list: ListLayout, id: string, keepOne = false): ListLayout {
  if (!ids.includes(id)) {
    return list
  }
  if (list.hidden.includes(id)) {
    return {order: list.order, hidden: list.hidden.filter((other) => other !== id)}
  }
  if (keepOne && visibleIds(ids, list, true).filter((other) => other !== id).length === 0) {
    return list
  }
  return {order: list.order, hidden: [...list.hidden, id]}
}

export function reorderItem(
  ids: string[], list: ListLayout, activeId: string, overId: string, keepOne = false
): ListLayout {
  const order = orderedIds(ids, list)
  const hidden = new Set(arrange(ids, list, keepOne).filter((item) => item.hidden).map((item) => item.id))
  const shown = order.filter((id) => !hidden.has(id))
  const from = shown.indexOf(activeId)
  const to = shown.indexOf(overId)
  if (from < 0 || to < 0 || from === to) {
    return list
  }
  shown.splice(to, 0, ...shown.splice(from, 1))
  let next = 0
  const sorted = order.map((id) => hidden.has(id) ? id : shown[next++] as string)
  return {order: [...sorted, ...list.order.filter((other) => !ids.includes(other))], hidden: list.hidden}
}
