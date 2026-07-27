import { beforeEach, describe, expect, it } from 'vitest'
import { createSavedLayout } from '../core/savedLayouts'
import {
  addObject,
  appliedHallLayoutId,
  applyHallLayout,
  applySavedLayout,
  newProject,
  removeObjects,
  undo,
} from './actions'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

beforeEach(() => {
  newProject({ name: 'saved-layout-test', venuePackId: 'resort' })
})

describe('applying a saved layout', () => {
  it('replaces only the previous tagged layout, refreshes identity, and undoes in one step', () => {
    const manual = addObject('plant.potted', { x: 300, y: 300 })
    const source = addObject('table.round', { x: 650, y: 650 })
    const saved = createSavedLayout('קבלת פנים', scene(), [source], 'layout-design', '2026-07-21T00:00:00.000Z')!
    const sourceChildren = Object.values(scene().objects).filter((object) => object.parentId === source)
    removeObjects([source])

    const builtIn = applyHallLayout('layout.knights-rows')
    const inserted = applySavedLayout(saved)

    expect(inserted).toHaveLength(1)
    expect(inserted[0]).not.toBe(source)
    expect(appliedHallLayoutId(scene())).toBe(saved.id)
    for (const id of builtIn) expect(scene().objects[id]).toBeUndefined()
    expect(scene().objects[manual]).toBeDefined()
    expect(Object.values(scene().objects).filter((object) => object.parentId === inserted[0])).toHaveLength(
      sourceChildren.length,
    )

    undo()
    expect(scene().objects[inserted[0]]).toBeUndefined()
    expect(appliedHallLayoutId(scene())).toBe('layout.knights-rows')
    expect(scene().objects[manual]).toBeDefined()
  })
})
