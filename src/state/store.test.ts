import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { HALL_LAYOUTS } from '../core/hallLayouts'
import { attachedChairs } from '../core/model/seatingReconciler'
import { getHallDesign, getTableDesign, getTablePreset } from '../core/presets'
import { getVenuePack } from '../core/venuePacks'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  addTablePreset,
  appliedHallLayoutId,
  applyHallDesign,
  applyHallLayout,
  applyTableDesign,
  applyTableDesignToAll,
  beginGesture,
  clearAllObjects,
  designItems,
  fillHallWithTables,
  hasHallLayout,
  removeHallDesign,
  removeHallLayout,
  removeTableDesign,
  duplicateObjects,
  endGesture,
  moveObjectsBy,
  newProject,
  redo,
  removeObjects,
  removeSeatItems,
  rotateObjectsBy,
  seatItems,
  select,
  setAppearance,
  setLayerHidden,
  setLayerLocked,
  setLocked,
  setSeatCount,
  setSize,
  undo,
} from './actions'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { isObjectVisible, objectAABB, visibleTopLevelIds } from './selectors'
import { projectFromState, temporalStore, useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

/** Read the round table's seat count from the catalog — it tracks the venue's real
 *  inventory (⌀180 seats 12) and has changed once already. */
const SEATS = getCatalogEntry('table.round').seating!.defaultCount

beforeEach(() => {
  newProject({ name: 'test', venueWidth: 2400, venueDepth: 1600 })
})

describe('object lifecycle + undo', () => {
  it('adds a round table with its default chairs, undo removes everything', () => {
    addObject('table.round', { x: 500, y: 500 })
    expect(scene().objectOrder).toHaveLength(1)
    expect(Object.keys(scene().objects)).toHaveLength(1 + SEATS)

    undo()
    expect(scene().objectOrder).toHaveLength(0)
    expect(Object.keys(scene().objects)).toHaveLength(0)

    redo()
    expect(Object.keys(scene().objects)).toHaveLength(1 + SEATS)
  })

  it('deleting a table cascades to attached chairs in one undo step', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    removeObjects([id])
    expect(Object.keys(scene().objects)).toHaveLength(0)
    undo()
    expect(Object.keys(scene().objects)).toHaveLength(1 + SEATS)
  })

  it('duplicate deep-copies the table with its chairs and offsets it', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    const [copyId] = duplicateObjects([id])
    expect(copyId).toBeDefined()
    expect(scene().objects[copyId].transform.position).toEqual({ x: 550, y: 550 })
    expect(attachedChairs(scene(), copyId)).toHaveLength(SEATS)
    expect(scene().objects[copyId].meta.number).toBe(2)
  })
})

describe('gestures', () => {
  it('a multi-step drag is exactly one undo entry', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    beginGesture()
    for (let i = 0; i < 20; i++) moveObjectsBy([id], { x: 10, y: 0 })
    endGesture()
    expect(scene().objects[id].transform.position.x).toBe(700)

    undo()
    expect(scene().objects[id].transform.position.x).toBe(500)
    // one more undo removes the add itself
    undo()
    expect(scene().objects[id]).toBeUndefined()
  })

  it('a no-op gesture records nothing', () => {
    addObject('table.round', { x: 500, y: 500 })
    const before = temporalStore.getState().pastStates.length
    beginGesture()
    endGesture()
    expect(temporalStore.getState().pastStates.length).toBe(before)
  })
})

describe('seating reconciliation', () => {
  it('seat count changes create/remove chairs', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    setSeatCount(id, 12)
    expect(attachedChairs(scene(), id)).toHaveLength(12)
    setSeatCount(id, 6)
    expect(attachedChairs(scene(), id)).toHaveLength(6)
  })

  it('resizing a table re-flows chairs outward', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    const rBefore = Math.hypot(
      attachedChairs(scene(), id)[0].transform.position.x,
      attachedChairs(scene(), id)[0].transform.position.y,
    )
    setSize(id, { width: 240 })
    const rAfter = Math.hypot(
      attachedChairs(scene(), id)[0].transform.position.x,
      attachedChairs(scene(), id)[0].transform.position.y,
    )
    expect(rAfter - rBefore).toBeCloseTo(30) // radius grew by half the diameter change
  })

  it('a manually nudged chair is left alone by the reconciler', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    const chair = attachedChairs(scene(), id)[0]
    moveObjectsBy([chair.id], { x: 30, y: 0 })
    const nudged = { ...scene().objects[chair.id].transform.position }
    setSeatCount(id, 11)
    expect(scene().objects[chair.id].transform.position).toEqual(nudged)
    const att = scene().objects[chair.id].attachment
    expect(att?.kind === 'seat' && att.manual).toBe(true)
  })

  it('seat count clamps to physical capacity', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    setSeatCount(id, 99)
    expect(scene().objects[id].seating?.count).toBe(13)
    expect(attachedChairs(scene(), id)).toHaveLength(13)
  })
})

describe('appearance permissions', () => {
  it('allows only the cloth slot on every table', () => {
    const tableIds = [
      'table.round',
      'table.round-large',
      'table.square',
      'table.banquet',
      'table.knights-480',
      'table.serpentine',
    ]
    for (const catalogId of tableIds) {
      expect(getCatalogEntry(catalogId).editableColorSlot).toBe('cloth')
      const id = addObject(catalogId, { x: 800, y: 800 })
      setAppearance([id], 'cloth', '#33518f')
      setAppearance([id], 'legs', '#ffffff')
      expect(scene().objects[id].appearance).toEqual({ cloth: { color: '#33518f' } })
    }
  })

  it('allows body on the two napkins and rejects every other item and slot', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    for (const catalogId of ['decor.napkin-folded', 'decor.napkin-white']) {
      expect(getCatalogEntry(catalogId).editableColorSlot).toBe('body')
      const id = addObjectToSurface(catalogId, tableId, { x: 500, y: 500 })!
      setAppearance([id], 'body', '#7a2e3f')
      setAppearance([id], 'cloth', '#ffffff')
      expect(scene().objects[id].appearance).toEqual({ body: { color: '#7a2e3f' } })
    }

    const chairId = attachedChairs(scene(), tableId)[0].id
    const plantId = addObject('plant.potted', { x: 900, y: 500 })
    const decorId = addObjectToSurface('decor.vase-ceramic', tableId, { x: 500, y: 500 })!
    setAppearance([chairId, plantId, decorId], 'body', '#ffffff')
    expect(scene().objects[chairId].appearance).toEqual({})
    expect(scene().objects[plantId].appearance).toEqual({})
    expect(scene().objects[decorId].appearance).toEqual({})
  })
})

describe('clear all objects', () => {
  it('clears locked roots and children, cancels placement, and supports undo/redo', () => {
    const venueBefore = scene().venue
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const plantId = addObject('plant.potted', { x: 900, y: 500 })
    setLocked([tableId], true)
    setLayerLocked('decor', true)
    select([tableId, plantId])
    overlay.setPlacing('plant.potted-2')

    const objectCount = Object.keys(scene().objects).length
    clearAllObjects()
    expect(scene().objectOrder).toEqual([])
    expect(scene().objects).toEqual({})
    expect(scene().venue).toEqual(venueBefore)
    expect(useEditorStore.getState().selection).toEqual([])
    expect(useOverlayStore.getState().placing).toBeNull()
    expect(useOverlayStore.getState().ghost).toBeNull()

    undo()
    expect(Object.keys(scene().objects)).toHaveLength(objectCount)
    expect(scene().objects[tableId].flags.locked).toBe(true)
    expect(scene().objects[plantId]).toBeDefined()

    redo()
    expect(scene().objects).toEqual({})
    expect(scene().objectOrder).toEqual([])
  })
})

describe('hard venue bounds', () => {
  it('clamps an object shoved past every venue edge', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    moveObjectsBy([id], { x: -9999, y: -9999 })
    let box = objectAABB(scene(), id)!
    expect(box.minX).toBeGreaterThanOrEqual(-0.01)
    expect(box.minY).toBeGreaterThanOrEqual(-0.01)
    moveObjectsBy([id], { x: 9999, y: 9999 })
    box = objectAABB(scene(), id)!
    expect(box.maxX).toBeLessThanOrEqual(2400.01)
    expect(box.maxY).toBeLessThanOrEqual(1600.01)
  })

  it('keeps attached chairs on the floor, not just the table', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    moveObjectsBy([id], { x: -9999, y: 0 })
    const minChairX = Math.min(
      ...attachedChairs(scene(), id).map((c) => objectAABB(scene(), c.id)!.minX),
    )
    expect(minChairX).toBeGreaterThanOrEqual(-0.01)
  })

  it('pushes furniture out of a restricted zone (resort pool)', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    // pool zone x[766,3962] y[1408,2544] reaches the far wall (venue depth 2544),
    // so a table dropped in it must exit upward where there is room.
    const id = addObject('table.round', { x: 2500, y: 2000 })
    const b = objectAABB(scene(), id)!
    const overlapsPool = b.minX < 3962 && b.maxX > 766 && b.minY < 2544 && b.maxY > 1408
    expect(overlapsPool).toBe(false)
    // and it stays on the floor (venue 4423×2544)
    expect(b.minX).toBeGreaterThanOrEqual(-0.01)
    expect(b.minY).toBeGreaterThanOrEqual(-0.01)
    expect(b.maxX).toBeLessThanOrEqual(4423.01)
    expect(b.maxY).toBeLessThanOrEqual(2544.01)
  })
})

describe('serialization', () => {
  it('project state survives a JSON round-trip', () => {
    addObject('table.round', { x: 500, y: 500 })
    addObject('dj.booth', { x: 1200, y: 200 })
    const project = projectFromState(useEditorStore.getState())
    const revived = JSON.parse(JSON.stringify(project))
    expect(revived.scene).toEqual(scene())
  })
})

describe('table-top decor (surface attachment)', () => {
  const TABLE_H = getCatalogEntry('table.round').defaultSize.height
  const DECOR = 'decor.candlestick-brass' // round, ⌀21.4

  it('drops onto a table as an attached child standing on the table height', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const decorId = addObjectToSurface(DECOR, tableId, { x: 520, y: 510 })!
    const decor = scene().objects[decorId]
    expect(decor.parentId).toBe(tableId)
    expect(decor.attachment).toEqual({ kind: 'surface' })
    expect(decor.transform.elevation).toBe(TABLE_H)
    // parent-local position = drop point minus table centre
    expect(decor.transform.position.x).toBeCloseTo(20)
    expect(decor.transform.position.y).toBeCloseTo(10)
    // children never enter objectOrder
    expect(scene().objectOrder).not.toContain(decorId)
  })

  it('is clamped to the table outline on drop and on drag', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const decorId = addObjectToSurface(DECOR, tableId, { x: 900, y: 500 })!
    const entry = getCatalogEntry(DECOR)
    const maxR =
      getCatalogEntry('table.round').defaultSize.width / 2 - entry.defaultSize.width / 2
    const at = () => scene().objects[decorId].transform.position
    expect(Math.hypot(at().x, at().y)).toBeLessThanOrEqual(maxR + 0.01)
    // drag far past the rim — stays on the rim
    moveObjectsBy([decorId], { x: 500, y: 300 })
    expect(Math.hypot(at().x, at().y)).toBeLessThanOrEqual(maxR + 0.01)
  })

  it('deleting the table removes its decor; duplicate copies it', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const decorId = addObjectToSurface(DECOR, tableId, { x: 500, y: 500 })!
    const [copyId] = duplicateObjects([tableId])
    const copiedDecor = Object.values(scene().objects).filter(
      (o) => o.parentId === copyId && o.attachment?.kind === 'surface',
    )
    expect(copiedDecor).toHaveLength(1)
    removeObjects([tableId])
    expect(scene().objects[decorId]).toBeUndefined()
  })

  it('deleting just the decor leaves the table and its seats untouched', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const decorId = addObjectToSurface(DECOR, tableId, { x: 500, y: 500 })!
    removeObjects([decorId])
    expect(scene().objects[decorId]).toBeUndefined()
    expect(scene().objects[tableId].seating?.count).toBe(SEATS)
    expect(attachedChairs(scene(), tableId)).toHaveLength(SEATS)
  })

  // Regression: the clamp used to collapse a ROTATED rect child to its circumradius
  // (45×33 → hw=hh=27.9 instead of 22.5/16.5), stopping it 8.4cm short of the rim on
  // every table. Shoved outward, a rotated decor must reach its EXACT rotated extent.
  it('a rotated rect decor reaches the exact rim, not its circumradius', () => {
    const RECT = 'decor.place-setting' // 45×33
    const shoveTo = (childId: string, deg: number, delta: { x: number; y: number }) => {
      rotateObjectsBy([childId], deg)
      moveObjectsBy([childId], delta)
      return scene().objects[childId].transform.position
    }
    const round = addObject('table.round', { x: 500, y: 500 })
    const onRound = addObjectToSurface(RECT, round, { x: 500, y: 500 })!
    // 33cm deep across the radius → 90 − 16.5, not the old 90 − 27.9 = 62.1
    expect(shoveTo(onRound, 180, { x: 0, y: 999 }).y).toBeCloseTo(73.5)

    const banquet = addObject('table.banquet', { x: 1000, y: 500 }) // 240×120
    const onLong = addObjectToSurface(RECT, banquet, { x: 1000, y: 500 })!
    expect(shoveTo(onLong, 180, { x: 0, y: 999 }).y).toBeCloseTo(43.5) // long side: 60 − 16.5
    const onEnd = addObjectToSurface(RECT, banquet, { x: 1000, y: 500 })!
    expect(shoveTo(onEnd, 90, { x: 999, y: 0 }).x).toBeCloseTo(103.5) // end: 120 − 16.5
  })
})

describe('place settings (seat placement)', () => {
  const SETTING = 'decor.place-setting'
  const settingsOn = (tableId: string) => seatItems(scene(), tableId)

  it('fills every seat of the table in one drop', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    addSeatItemsToTable(SETTING, tableId)
    const items = settingsOn(tableId)
    expect(items).toHaveLength(SEATS)
    for (const item of items) {
      expect(item.parentId).toBe(tableId)
      expect(item.attachment).toEqual({ kind: 'surface' })
      expect(scene().objectOrder).not.toContain(item.id)
    }
  })

  it('re-dropping replaces the set instead of doubling it', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    addSeatItemsToTable(SETTING, tableId)
    const firstIds = settingsOn(tableId).map((o) => o.id)
    setSeatCount(tableId, 8)
    addSeatItemsToTable(SETTING, tableId) // the re-sync gesture
    expect(settingsOn(tableId)).toHaveLength(8)
    for (const id of firstIds) expect(scene().objects[id]).toBeUndefined()
  })

  // The point of the part-2 clamp fix: every setting is rotated, and the clamp
  // must not move a single one of them.
  it('survives clampToSurface untouched on both table shapes', () => {
    for (const table of ['table.round', 'table.banquet']) {
      newProject({ name: 'test', venueWidth: 2400, venueDepth: 1600 })
      const tableId = addObject(table, { x: 800, y: 600 })
      addSeatItemsToTable(SETTING, tableId)
      const before = settingsOn(tableId).map((o) => ({ ...o.transform.position }))
      expect(before.length).toBeGreaterThan(0)
      // any transform action re-runs the clamp over the table's children
      moveObjectsBy([tableId], { x: 1, y: 1 })
      settingsOn(tableId).forEach((o, i) => {
        expect(o.transform.position.x).toBeCloseTo(before[i].x)
        expect(o.transform.position.y).toBeCloseTo(before[i].y)
      })
    }
  })

  it('removeSeatItems clears the settings and leaves the chairs', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    addSeatItemsToTable(SETTING, tableId)
    removeSeatItems(tableId)
    expect(settingsOn(tableId)).toHaveLength(0)
    expect(attachedChairs(scene(), tableId)).toHaveLength(SEATS)
    expect(scene().objects[tableId].seating?.count).toBe(SEATS)
  })

  it('keeps ordinary surface decor when the settings are removed', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const vaseId = addObjectToSurface('decor.candlestick-brass', tableId, { x: 500, y: 500 })!
    addSeatItemsToTable(SETTING, tableId)
    removeSeatItems(tableId)
    expect(scene().objects[vaseId]).toBeDefined()
  })

  it('deleting the table takes its settings with it, in one undo step', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    addSeatItemsToTable(SETTING, tableId)
    const ids = settingsOn(tableId).map((o) => o.id)
    removeObjects([tableId])
    for (const id of ids) expect(scene().objects[id]).toBeUndefined()
    undo()
    expect(settingsOn(tableId)).toHaveLength(SEATS)
  })

  it('one drop is one undo entry', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    addSeatItemsToTable(SETTING, tableId)
    expect(settingsOn(tableId)).toHaveLength(SEATS)
    undo()
    expect(settingsOn(tableId)).toHaveLength(0)
    expect(attachedChairs(scene(), tableId)).toHaveLength(SEATS)
  })
})

describe('fixed stations (zone lock)', () => {
  it('a DJ booth dropped anywhere in the resort snaps into its zone and cannot leave', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const id = addObject('dj.booth', { x: 300, y: 300 }) // far from the DJ zone
    expect(scene().objects[id].transform.rotation).toBe(-180)
    const inZone = () => {
      const b = objectAABB(scene(), id)!
      return b.minX >= 2268.99 && b.maxX <= 2579.01 && b.minY >= 1407.99 && b.maxY <= 1641.01
    }
    expect(inZone()).toBe(true)
    moveObjectsBy([id], { x: -2000, y: -1000 })
    expect(inZone()).toBe(true)
    moveObjectsBy([id], { x: 9999, y: 9999 })
    expect(inZone()).toBe(true)
  })

  it('a bar unit lives only inside the bar zone', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const id = addObject('bar.straight', { x: 4000, y: 2400 })
    const b = objectAABB(scene(), id)!
    expect(b.minX).toBeGreaterThanOrEqual(1788.99)
    expect(b.maxX).toBeLessThanOrEqual(2589.01)
    expect(b.minY).toBeGreaterThanOrEqual(-0.01)
    expect(b.maxY).toBeLessThanOrEqual(300.01)
  })

  it('in a procedural room (no zones) the DJ booth places freely', () => {
    const id = addObject('dj.booth', { x: 700, y: 700 })
    expect(scene().objects[id].transform.position).toEqual({ x: 700, y: 700 })
  })
})

describe('category layers', () => {
  it('hiding tables hides the table subtree and prunes the selection', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    select([id])
    setLayerHidden('tables', true)
    expect(visibleTopLevelIds(scene())).toHaveLength(0)
    // attached chairs follow their hidden table even though seating is visible
    expect(isObjectVisible(scene(), attachedChairs(scene(), id)[0].id)).toBe(false)
    expect(useEditorStore.getState().selection).toHaveLength(0)
    setLayerHidden('tables', false)
    expect(visibleTopLevelIds(scene())).toEqual([id])
    expect(scene().settings.layers).toEqual({})
  })

  it('hiding seating hides chairs (attached and detached) but not their table', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    const detached = addObject('chair.x-white', { x: 100, y: 100 })
    setLayerHidden('seating', true)
    expect(visibleTopLevelIds(scene())).toEqual([id])
    expect(isObjectVisible(scene(), attachedChairs(scene(), id)[0].id)).toBe(false)
    expect(isObjectVisible(scene(), detached)).toBe(false)
  })

  it('a locked layer blocks move/rotate/resize/recolor/delete', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    setLayerLocked('tables', true)
    moveObjectsBy([id], { x: 100, y: 0 })
    expect(scene().objects[id].transform.position.x).toBe(500)
    rotateObjectsBy([id], 90)
    expect(scene().objects[id].transform.rotation).toBe(0)
    setSize(id, { width: 500 })
    expect(scene().objects[id].size.width).toBe(getCatalogEntry('table.round').defaultSize.width)
    setAppearance([id], 'cloth', '#ff0000')
    expect(scene().objects[id].appearance.cloth).toBeUndefined()
    removeObjects([id])
    expect(scene().objects[id]).toBeDefined()
    setLayerLocked('tables', false)
    removeObjects([id])
    expect(scene().objects[id]).toBeUndefined()
  })

  it('undo of a hide restores visibility; redo re-hides with selection pruned', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    select([id])
    setLayerHidden('tables', true)
    undo()
    expect(visibleTopLevelIds(scene())).toEqual([id])
    redo()
    expect(visibleTopLevelIds(scene())).toHaveLength(0)
    expect(useEditorStore.getState().selection).toHaveLength(0)
  })

  it('placing an item into a hidden category auto-unhides it', () => {
    setLayerHidden('tables', true)
    const id = addObject('table.round', { x: 500, y: 500 })
    expect(visibleTopLevelIds(scene())).toEqual([id])
    expect(scene().settings.layers).toEqual({})
  })

  it('layer unlock leaves a per-object lock in place', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    setLocked([id], true)
    setLayerLocked('tables', true)
    setLayerLocked('tables', false)
    moveObjectsBy([id], { x: 100, y: 0 })
    expect(scene().objects[id].transform.position.x).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------

const PRESET = getTablePreset('preset.round-12-gold-white')!
const DESIGN = getTableDesign('design.classic-gold')!
const topLevel = () => scene().objectOrder.map((id) => scene().objects[id])

describe('table presets', () => {
  it('drops the table with the preset chair and seat count, numbered', () => {
    const id = addTablePreset(PRESET.id, { x: 600, y: 600 })!
    const table = scene().objects[id]
    expect(table.seating!.chairCatalogId).toBe(PRESET.chairCatalogId)
    expect(attachedChairs(scene(), id)).toHaveLength(PRESET.seatCount)
    expect(table.meta.number).toBe(1)
    undo()
    expect(Object.keys(scene().objects)).toHaveLength(0)
  })

  it('unhides both the table and the chair layer', () => {
    setLayerHidden('tables', true)
    setLayerHidden('seating', true)
    addTablePreset(PRESET.id, { x: 600, y: 600 })
    expect(scene().settings.layers).toEqual({})
  })

  it('an unknown preset id is a no-op', () => {
    expect(addTablePreset('preset.nope', { x: 0, y: 0 })).toBeNull()
    expect(scene().objectOrder).toHaveLength(0)
  })
})

describe('fill hall', () => {
  it('lays several non-overlapping tables inside the venue, in one undo entry', () => {
    const ids = fillHallWithTables(PRESET.id)
    expect(ids.length).toBeGreaterThan(1)
    for (const id of ids) {
      const box = objectAABB(scene(), id)!
      expect(box.minX).toBeGreaterThanOrEqual(0)
      expect(box.minY).toBeGreaterThanOrEqual(0)
      expect(box.maxX).toBeLessThanOrEqual(scene().venue.size.width)
      expect(box.maxY).toBeLessThanOrEqual(scene().venue.size.depth)
    }
    const numbers = ids.map((id) => scene().objects[id].meta.number)
    expect(new Set(numbers).size).toBe(ids.length)

    undo()
    expect(scene().objectOrder).toHaveLength(0)
  })

  it('is additive — a second run finds no room and adds nothing', () => {
    const first = fillHallWithTables(PRESET.id)
    const before = scene().objectOrder.length
    expect(fillHallWithTables(PRESET.id)).toHaveLength(0)
    expect(scene().objectOrder).toHaveLength(before)
    expect(scene().objectOrder.slice(0, first.length)).toEqual(first)
  })
})

describe('table designs', () => {
  it('lays the decor plus one place setting per seat, all tagged', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    applyTableDesign(DESIGN.id, id)
    const laid = designItems(scene(), id)
    expect(laid).toHaveLength(DESIGN.items.length + SEATS)
    expect(laid.every((o) => o.meta.design === DESIGN.id)).toBe(true)
    expect(laid.every((o) => o.attachment?.kind === 'surface')).toBe(true)
    expect(laid.every((o) => o.transform.elevation === scene().objects[id].size.height)).toBe(true)
  })

  it('is idempotent — re-applying replaces instead of stacking', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    applyTableDesign(DESIGN.id, id)
    const first = designItems(scene(), id).map((o) => o.id)
    applyTableDesign(DESIGN.id, id)
    const second = designItems(scene(), id).map((o) => o.id)
    expect(second).toHaveLength(first.length)
    expect(second).not.toEqual(first) // genuinely re-laid, not left alone
  })

  it('switching design replaces the previous one', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    applyTableDesign(DESIGN.id, id)
    applyTableDesign('design.crystal', id)
    const laid = designItems(scene(), id)
    expect(laid.every((o) => o.meta.design === 'design.crystal')).toBe(true)
    expect(laid).toHaveLength(getTableDesign('design.crystal')!.items.length + SEATS)
  })

  it('replaces hand-dropped place settings rather than doubling them up', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    addSeatItemsToTable('decor.place-setting', id)
    expect(seatItems(scene(), id)).toHaveLength(SEATS)
    applyTableDesign(DESIGN.id, id)
    expect(seatItems(scene(), id)).toHaveLength(SEATS)
  })

  it('leaves hand-placed decor alone on apply and on remove', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    const manual = addObjectToSurface('decor.vase-ceramic', id, { x: 600, y: 630 })!
    applyTableDesign(DESIGN.id, id)
    expect(scene().objects[manual]).toBeDefined()
    removeTableDesign(id)
    expect(designItems(scene(), id)).toHaveLength(0)
    expect(scene().objects[manual]).toBeDefined()
  })

  it('a locked table refuses the design', () => {
    const id = addObject('table.round', { x: 600, y: 600 })
    setLocked([id], true)
    expect(applyTableDesign(DESIGN.id, id)).toHaveLength(0)
    setLocked([id], false)
    setLayerLocked('tables', true)
    expect(applyTableDesign(DESIGN.id, id)).toHaveLength(0)
  })

  it('applies to every table and undoes all of them in ONE step', () => {
    const ids = [
      addObject('table.round', { x: 400, y: 400 }),
      addObject('table.round', { x: 1200, y: 400 }),
      addObject('table.round', { x: 400, y: 1200 }),
    ]
    applyTableDesignToAll(DESIGN.id)
    for (const id of ids) expect(designItems(scene(), id).length).toBeGreaterThan(0)

    undo()
    for (const id of ids) expect(designItems(scene(), id)).toHaveLength(0)
  })

  it('apply-to-all skips locked tables', () => {
    const free = addObject('table.round', { x: 400, y: 400 })
    const locked = addObject('table.round', { x: 1200, y: 400 })
    setLocked([locked], true)
    applyTableDesignToAll(DESIGN.id)
    expect(designItems(scene(), free).length).toBeGreaterThan(0)
    expect(designItems(scene(), locked)).toHaveLength(0)
  })
})

describe('hall designs', () => {
  const HALL = getHallDesign('hall.chandeliers-diamond')!

  it('hangs the fixtures at ceiling height, tagged, in one undo entry', () => {
    const ids = applyHallDesign(HALL.id)
    expect(ids.length).toBeGreaterThan(0)
    const drop = getCatalogEntry(HALL.catalogId).defaultSize.height
    for (const id of ids) {
      const obj = scene().objects[id]
      // regression: addObject used to ignore the venue and hang everything at 350
      expect(obj.transform.elevation).toBe(scene().venue.wallHeight - drop)
      expect(obj.meta.design).toBe(HALL.id)
      expect(scene().objectOrder).toContain(id)
    }
    undo()
    expect(scene().objectOrder).toHaveLength(0)
  })

  it('re-applying replaces the previous hall design', () => {
    const first = applyHallDesign(HALL.id)
    const second = applyHallDesign('hall.pendants')
    expect(topLevel().every((o) => o.meta.design === 'hall.pendants')).toBe(true)
    for (const id of first) expect(scene().objects[id]).toBeUndefined()
    expect(second.length).toBeGreaterThan(0)
  })

  it('removal clears the fixtures and the order list together', () => {
    applyHallDesign(HALL.id)
    removeHallDesign()
    expect(scene().objectOrder).toHaveLength(0)
    expect(Object.keys(scene().objects)).toHaveLength(0)
  })

  it('leaves ordinary furniture untouched', () => {
    const table = addObject('table.round', { x: 600, y: 600 })
    applyHallDesign(HALL.id)
    removeHallDesign()
    expect(scene().objects[table]).toBeDefined()
    expect(scene().objectOrder).toEqual([table])
  })

  it('a ceiling fixture is not pushed out of a restricted zone', () => {
    // regression: clampToVenue's zone push treated chandeliers as furniture, so
    // nothing could ever hang over the dance floor.
    newProject({ name: 'resort', venuePackId: 'resort' })
    const zone = getVenuePack('resort')!.restricted!.find((z) => z.kind === 'dancefloor')!
    const at = { x: zone.x + zone.width / 2, y: zone.y + zone.depth / 2 }
    const id = addObject('lamp.chandelier-diamond', at)
    expect(scene().objects[id].transform.position).toEqual(at)
  })
})

describe('hall layouts', () => {
  const LAYOUT = HALL_LAYOUTS[0]

  it('places the authored tables seated and tagged, in one undo entry', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const ids = applyHallLayout(LAYOUT.id)
    expect(ids).toHaveLength(LAYOUT.placements.length)
    const first = scene().objects[ids[0]]
    expect(first.meta.layout).toBe(LAYOUT.id)
    expect(first.meta.number).toBe(1)
    expect(attachedChairs(scene(), ids[0]).length).toBeGreaterThan(0)
    expect(appliedHallLayoutId(scene())).toBe(LAYOUT.id)
    undo()
    expect(hasHallLayout(scene())).toBe(false)
  })

  it('re-applying replaces the previous layout; hand-placed furniture survives', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const table = addObject('table.round', { x: 400, y: 400 })
    const first = applyHallLayout('layout.rounds-classic')
    const second = applyHallLayout('layout.knights-rows')
    for (const id of first) expect(scene().objects[id]).toBeUndefined()
    expect(second.length).toBeGreaterThan(0)
    expect(appliedHallLayoutId(scene())).toBe('layout.knights-rows')
    expect(scene().objects[table]).toBeDefined()
    removeHallLayout()
    expect(hasHallLayout(scene())).toBe(false)
    expect(scene().objects[table]).toBeDefined()
    expect(attachedChairs(scene(), table).length).toBeGreaterThan(0)
  })
})
