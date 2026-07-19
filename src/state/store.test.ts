import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { attachedChairs } from '../core/model/seatingReconciler'
import {
  addObject,
  addObjectToSurface,
  beginGesture,
  detachChair,
  duplicateObjects,
  endGesture,
  moveObjectsBy,
  newProject,
  redo,
  removeObjects,
  rotateObjectsBy,
  select,
  setAppearance,
  setLayerHidden,
  setLayerLocked,
  setLocked,
  setSeatCount,
  setSize,
  undo,
} from './actions'
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

  it('detaching a chair bakes world position and shrinks the seat count', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    const chair = attachedChairs(scene(), id)[0]
    const localX = chair.transform.position.x
    detachChair(chair.id)
    const detached = scene().objects[chair.id]
    expect(detached.parentId).toBeNull()
    expect(detached.attachment).toBeUndefined()
    expect(detached.transform.position.x).toBeCloseTo(500 + localX)
    expect(scene().objects[id].seating?.count).toBe(SEATS - 1)
    expect(attachedChairs(scene(), id)).toHaveLength(SEATS - 1)
    expect(scene().objectOrder).toContain(chair.id)
  })

  it('seat count clamps to physical capacity', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    setSeatCount(id, 99)
    expect(scene().objects[id].seating?.count).toBe(13)
    expect(attachedChairs(scene(), id)).toHaveLength(13)
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
})

describe('fixed stations (zone lock)', () => {
  it('a DJ booth dropped anywhere in the resort snaps into its zone and cannot leave', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const id = addObject('dj.booth', { x: 300, y: 300 }) // far from the DJ zone
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
