import {createContext, useContext} from 'react'
import {KeyboardSensor, PointerSensor, useSensor, useSensors} from '@dnd-kit/core'
import {sortableKeyboardCoordinates} from '@dnd-kit/sortable'
import {useSetting} from '@/core/settings'
import {normalizeLayout, type ControlLayout} from './layout'

export function useControlLayout(): [ControlLayout, (layout: ControlLayout | null) => void] {
  const [stored, set] = useSetting<ControlLayout | null>('controlLayout', null)
  return [normalizeLayout(stored), set]
}

export function useLayoutSensors() {
  return useSensors(
    useSensor(PointerSensor, {activationConstraint: {distance: 6}})
    , useSensor(KeyboardSensor, {coordinateGetter: sortableKeyboardCoordinates})
  )
}

const EditingContext = createContext(false)

export const EditingProvider = EditingContext.Provider

export function useEditing(): boolean {
  return useContext(EditingContext)
}
