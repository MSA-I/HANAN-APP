import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { holeRadius } from '../core/layout/bounds'
import { createLightingLayout, createSavedLayout } from '../core/savedLayouts'
import {
  addObject,
  appliedHallLayoutId,
  appliedLightingLayoutId,
  applyHallLayout,
  applySavedLayout,
  applySavedTableDesign,
  applyTableDesign,
  captureTableDesign,
  designItems,
  newProject,
  removeObjects,
  seatItems,
  setLayerLocked,
  undo,
} from './actions'
import { useNoticeStore } from './notice'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const surfaceOf = (id: string) =>
  Object.values(scene().objects).filter((o) => o.parentId === id && o.attachment?.kind === 'surface')

beforeEach(() => {
  newProject({ name: 'saved-layout-test', venuePackId: 'resort' })
  useNoticeStore.setState({ message: '', seq: 0 })
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

  /** Source doc §32 — the gap the v8 tag split closes. */
  it('keeps a table layout and a lighting layout applied at the same time', () => {
    const table = addObject('table.round', { x: 650, y: 650 })
    const tables = createSavedLayout('שולחנות', scene(), [table], 'layout')!
    removeObjects([table])
    addObject('lamp.pendant', { x: 900, y: 900 })
    const lighting = createLightingLayout('תאורה', scene())!

    const tableIds = applySavedLayout(tables)
    const lightIds = applySavedLayout(lighting)

    expect(tableIds).toHaveLength(1)
    expect(lightIds).toHaveLength(1)
    // applying the lighting layout must NOT have deleted the tables
    expect(scene().objects[tableIds[0]]).toBeDefined()
    expect(appliedHallLayoutId(scene())).toBe(tables.id)
    expect(appliedLightingLayoutId(scene())).toBe(lighting.id)
  })

  it('says why instead of failing silently on a venue mismatch', () => {
    const table = addObject('table.round', { x: 650, y: 650 })
    const saved = createSavedLayout('אולם אחר', scene(), [table], 'layout')!
    saved.venue = { kind: 'manual', width: 1, depth: 1 }

    expect(applySavedLayout(saved)).toEqual([])
    expect(useNoticeStore.getState().message).not.toBe('')
  })

  it('refuses a layout whose catalog items are gone rather than throwing', () => {
    const table = addObject('table.round', { x: 650, y: 650 })
    const saved = createSavedLayout('ישנה', scene(), [table], 'layout')!
    saved.subtrees[0].root.catalogId = 'table.retired'

    expect(() => applySavedLayout(saved)).not.toThrow()
    expect(applySavedLayout(saved)).toEqual([])
    expect(useNoticeStore.getState().message).not.toBe('')
  })
})

/** The ⌀380 outline, which carries the opening the clamp has to keep decor out of. */
const ringOutline = () => {
  const e = getCatalogEntry('table.round-large')
  return e.footprint(e.defaultSize).outline
}

describe('captured table designs', () => {
  it('re-lays a hand-made arrangement on another table, scaled to its size', () => {
    const small = addObject('table.round', { x: 600, y: 600 })
    applyTableDesign('design.classic-gold', small)
    const captured = captureTableDesign(small, 'זהב שלי')!
    expect(captured.kind).toBe('tableDesign')

    const large = addObject('table.round-large', { x: 1400, y: 900 })
    const laid = applySavedTableDesign(captured, large)

    expect(laid.length).toBeGreaterThan(0)
    expect(designItems(scene(), large).length).toBe(laid.length)
    // place settings follow the TARGET's seat count, not the source's
    expect(seatItems(scene(), large)).toHaveLength(scene().objects[large].seating!.count)

    // The off-centre decor scales with the diameter instead of huddling in the
    // middle — but ⌀380 is a RING, and its scaled position lands over the 78 cm
    // opening (source doc §48), so the clamp pushes it clear of it. Both rules
    // apply, and the larger of the two wins.
    const ratio =
      getCatalogEntry('table.round-large').defaultSize.width /
      getCatalogEntry('table.round').defaultSize.width
    const decorOf = (id: string) =>
      surfaceOf(id).filter((o) => getCatalogEntry(o.catalogId).placement !== 'seat')
    const reach = (id: string) =>
      Math.max(...decorOf(id).map((o) => Math.abs(o.transform.position.x)))

    const outer = decorOf(large).reduce(
      (best, o) =>
        Math.abs(o.transform.position.x) > Math.abs(best.transform.position.x) ? o : best,
      decorOf(large)[0],
    )
    const e = getCatalogEntry(outer.catalogId)
    const o = e.footprint(outer.size).outline
    const itemReach = o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
    const clearOfHole = holeRadius(ringOutline()) + itemReach

    expect(reach(small) * ratio).toBeLessThan(clearOfHole) // the scaling alone would overhang
    expect(reach(large)).toBeCloseTo(clearOfHole, 1)
  })

  it('a table with nothing on it has no design to capture', () => {
    const bare = addObject('table.round', { x: 600, y: 600 })
    expect(captureTableDesign(bare, 'ריק')).toBeNull()
  })

  it('explains a refused apply instead of doing nothing', () => {
    const table = addObject('table.round', { x: 600, y: 600 })
    setLayerLocked('tables', true)

    expect(applyTableDesign('design.classic-gold', table)).toEqual([])
    expect(useNoticeStore.getState().message).not.toBe('')
    expect(designItems(scene(), table)).toEqual([])
  })
})
