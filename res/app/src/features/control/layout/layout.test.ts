import {describe, expect, it} from 'vitest'
import {arrange, emptyList, reorderItem, normalizeLayout, toggleItem, visibleIds} from './layout'

const ids = ['a', 'b', 'c', 'd']

describe('control layout', () => {
  it('keeps the default order without a saved layout', () => {
    expect(visibleIds(ids, emptyList)).toEqual(ids)
  })

  it('follows the saved order and ignores unknown ids', () => {
    expect(visibleIds(ids, {order: ['c', 'x', 'a'], hidden: ['y']})).toEqual(['c', 'd', 'a', 'b'])
  })

  it('places new ids after their default predecessor', () => {
    expect(visibleIds(['a', 'n', 'b', 'c'], {order: ['c', 'a', 'b'], hidden: []})).toEqual(['c', 'a', 'n', 'b'])
    expect(visibleIds(['n', 'a', 'b'], {order: ['b', 'a'], hidden: []})).toEqual(['n', 'b', 'a'])
  })

  it('hides items and toggles them back', () => {
    const hidden = toggleItem(ids, emptyList, 'b')
    expect(visibleIds(ids, hidden)).toEqual(['a', 'c', 'd'])
    expect(visibleIds(ids, toggleItem(ids, hidden, 'b'))).toEqual(ids)
  })

  it('never hides the last visible item when keepOne is set', () => {
    let list = emptyList
    for (const id of ['a', 'b', 'c', 'd']) {
      list = toggleItem(ids, list, id, true)
    }
    expect(visibleIds(ids, list, true)).toEqual(['d'])
    expect(toggleItem(ids, list, 'd', true)).toBe(list)
    expect(visibleIds(ids, {order: [], hidden: ids}, true)).toEqual(['a'])
    expect(arrange(ids, {order: [], hidden: ids}).every((item) => item.hidden)).toBe(true)
  })

  it('normalizes malformed stored values', () => {
    expect(normalizeLayout('dashboard')).toEqual({panes: emptyList, blocks: {}})
    expect(normalizeLayout(null)).toEqual({panes: emptyList, blocks: {}})
    expect(normalizeLayout({panes: {order: ['a', 1], hidden: 'x'}, blocks: {p: {order: ['z']}, q: 3}}))
      .toEqual({
        panes: {order: ['a'], hidden: []}
        , blocks: {p: {order: ['z'], hidden: []}, q: {order: [], hidden: []}}
      })
  })
})

describe('reorderItem', () => {
  it('moves a visible item and keeps hidden items in their slots', () => {
    const list = {order: [], hidden: ['b']}
    expect(reorderItem(ids, list, 'a', 'c')).toEqual({order: ['c', 'b', 'a', 'd'], hidden: ['b']})
    expect(visibleIds(ids, reorderItem(ids, list, 'd', 'a'))).toEqual(['d', 'a', 'c'])
  })

  it('ignores unknown or identical targets and keeps unrelated saved ids', () => {
    const list = {order: ['x'], hidden: []}
    expect(reorderItem(ids, list, 'a', 'a')).toBe(list)
    expect(reorderItem(ids, list, 'a', 'zzz')).toBe(list)
    expect(reorderItem(ids, list, 'a', 'b').order).toEqual(['b', 'a', 'c', 'd', 'x'])
  })
})
