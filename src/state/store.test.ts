import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry, listByCategory, listCatalog } from '../core/catalog/registry'
import { HALL_LAYOUTS } from '../core/hallLayouts'
import { hangRange, MAX_DROP_FROM_CEILING } from '../core/layout/beams'
import { attachedChairs } from '../core/model/seatingReconciler'
import { getHallDesign, getTableDesign, getTablePreset, TABLE_DESIGNS } from '../core/presets'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
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
  canReplaceObject,
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
  replaceObject,
  removeSeatItems,
  rotateObjectsBy,
  seatItems,
  select,
  setAppearance,
  setElevation,
  setLayerHidden,
  setLayerLocked,
  setLocked,
  setPosition,
  setRotation,
  setSeatCount,
  setSize,
  setSlotTexture,
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

  it('a live 3D rotation is exactly one undo entry', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    beginGesture()
    for (const rotation of [12, 34, 67]) setRotation(id, rotation)
    endGesture()
    expect(scene().objects[id].transform.rotation).toBe(67)

    undo()
    expect(scene().objects[id].transform.rotation).toBe(0)
  })

  it('a live 3D move is exactly one undo entry', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    beginGesture()
    for (const position of [{ x: 520, y: 530 }, { x: 650, y: 700 }]) setPosition(id, position)
    endGesture()
    expect(scene().objects[id].transform.position).toEqual({ x: 650, y: 700 })

    undo()
    expect(scene().objects[id].transform.position).toEqual({ x: 500, y: 500 })
  })
})

describe('replace object', () => {
  it('keeps identity and transform, replaces defaults, and undoes once', () => {
    const id = addObject('table.round', { x: 500, y: 600 })
    setRotation(id, 37)

    expect(replaceObject(id, 'table.square')).toBe(true)
    expect(scene().objects[id]).toMatchObject({
      id,
      catalogId: 'table.square',
      transform: { position: { x: 500, y: 600 }, rotation: 37 },
    })
    expect(useEditorStore.getState().selection).toEqual([id])

    undo()
    expect(scene().objects[id].catalogId).toBe('table.round')
    expect(scene().objects[id].transform.rotation).toBe(37)

    setLocked([id], true)
    expect(replaceObject(id, 'table.square')).toBe(false)
    expect(scene().objects[id].catalogId).toBe('table.round')
  })

  // source doc §24: "if I have an item standing on the table it cannot be
  // swapped for one that belongs to the ceiling"
  describe('placement classes', () => {
    it('refuses to swap across placement classes', () => {
      const table = addObject('table.round', { x: 500, y: 600 })
      expect(canReplaceObject(scene(), table, 'lamp.pendant')).toBe(false)
      expect(replaceObject(table, 'lamp.pendant')).toBe(false)

      const decor = addObjectToSurface('decor.vase-ceramic', table, { x: 500, y: 600 })!
      expect(canReplaceObject(scene(), decor, 'lamp.chandelier-diamond')).toBe(false)
      expect(canReplaceObject(scene(), decor, 'plant.potted')).toBe(false)
    })

    it('allows a swap inside the same class', () => {
      const table = addObject('table.round', { x: 500, y: 600 })
      expect(canReplaceObject(scene(), table, 'table.square')).toBe(true)
      const lamp = addObject('lamp.pendant', { x: 300, y: 300 })
      expect(canReplaceObject(scene(), lamp, 'lamp.chandelier-basket')).toBe(true)
      const decor = addObjectToSurface('decor.vase-ceramic', table, { x: 500, y: 600 })!
      expect(canReplaceObject(scene(), decor, 'decor.vase-flowers-a')).toBe(true)
    })

    it('keeps a zone-bound station inside its own zone kind', () => {
      newProject({ name: 'resort', venuePackId: 'resort' })
      const dj = addObject('dj.booth', { x: 2400, y: 1500 })
      // a DJ booth is clamped INTO the DJ zone; a plain floor item is not
      expect(getCatalogEntry('dj.booth').zoneKind).toBe('dj')
      expect(canReplaceObject(scene(), dj, 'table.round')).toBe(false)
      expect(canReplaceObject(scene(), dj, 'bar.resort-left')).toBe(false)
    })
  })

  // source doc §25: "if I chose to replace a table and it had designs on it, the
  // designs should apply to the replacement too"
  describe('keeps the table dressed', () => {
    it('re-runs a table design against the new geometry', () => {
      const id = addObject('table.round', { x: 500, y: 600 })
      const design = getTableDesign('design.classic-gold')!
      applyTableDesign(design.id, id)
      const before = designItems(scene(), id).length
      expect(before).toBeGreaterThan(0)

      expect(replaceObject(id, 'table.square')).toBe(true)
      const after = designItems(scene(), id)
      expect(after.length).toBeGreaterThan(0)
      expect(after.every((c) => c.meta.design === design.id)).toBe(true)
      // laid out fresh, so every piece sits on the NEW top
      expect(after.every((c) => c.transform.elevation === scene().objects[id].size.height)).toBe(true)
    })

    it('re-lays hand-dropped place settings', () => {
      const id = addObject('table.round', { x: 500, y: 600 })
      addSeatItemsToTable('decor.place-setting', id)
      expect(seatItems(scene(), id).length).toBe(SEATS)

      replaceObject(id, 'table.square')
      // count follows the NEW table's seating, not the old one
      expect(seatItems(scene(), id).length).toBe(scene().objects[id].seating!.count)
    })

    it('carries hand-placed decor over, re-anchored to the new table', () => {
      const id = addObject('table.round', { x: 800, y: 800 })
      const width = scene().objects[id].size.width
      // dropped off-centre, but §28 anchors a hand-placed centrepiece to the middle
      addObjectToSurface('decor.vase-ceramic', id, { x: 800 + width / 4, y: 800 })
      const before = Object.values(scene().objects).find(
        (o) => o.parentId === id && o.attachment?.kind === 'surface',
      )!
      expect(before.transform.position).toEqual({ x: 0, y: 0 })
      expect(before.transform.elevation).toBe(scene().objects[id].size.height)

      // the ring table's middle is its opening, so the same rule now puts the
      // piece on the FLOOR through it (source doc §48)
      replaceObject(id, 'table.round-large')
      const decor = Object.values(scene().objects).filter(
        (o) => o.parentId === id && o.attachment?.kind === 'surface',
      )
      expect(decor).toHaveLength(1)
      expect(scene().objects[id].size.width).toBeGreaterThan(width)
      expect(decor[0].transform.position).toEqual({ x: 0, y: 0 })
      expect(decor[0].transform.elevation).toBe(0)
    })

    it('is still a single undo entry', () => {
      const id = addObject('table.round', { x: 500, y: 600 })
      applyTableDesign('design.classic-gold', id)
      replaceObject(id, 'table.square')
      undo()
      expect(scene().objects[id].catalogId).toBe('table.round')
      expect(designItems(scene(), id).length).toBeGreaterThan(0)
    })
  })
})

describe('hang height', () => {
  beforeEach(() => {
    newProject({ name: 'resort', venuePackId: 'resort' })
  })

  it('lowers a fixture and clamps to 4 m below the CEILING', () => {
    const id = addObject('lamp.chandelier-diamond', { x: 1000, y: 200 })
    // read the drop from the catalog: it is a catalogued size, not a constant of
    // the venue, and it has already moved once (×2.5, corrections document §8)
    const drop = getCatalogEntry('lamp.chandelier-diamond').defaultSize.height
    const top = 895 - drop
    expect(scene().objects[id].transform.elevation).toBe(top)
    // the limit is measured off the roof (1160), not the truss it hangs from
    const { min } = hangRange({ hangHeight: 895 }, 1160, drop)
    expect(min).toBe(1160 - MAX_DROP_FROM_CEILING - drop)
    // ...which is genuinely below the anchor, so there is a band to slide in
    expect(min).toBeLessThan(top)

    const middle = Math.round((min + top) / 2)
    setElevation(id, middle)
    expect(scene().objects[id].transform.elevation).toBe(middle)
    setElevation(id, 0)
    expect(scene().objects[id].transform.elevation).toBe(min)
    setElevation(id, 9999)
    expect(scene().objects[id].transform.elevation).toBe(top)
  })

  it('refuses anything that is not hung from the ceiling', () => {
    const table = addObject('table.round', { x: 500, y: 600 })
    setElevation(table, 400)
    expect(scene().objects[table].transform.elevation).toBe(0)
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
      expect(getCatalogEntry(catalogId).editableSlots?.map((s) => s.slot)).toEqual(['cloth'])
      const id = addObject(catalogId, { x: 800, y: 800 })
      setAppearance([id], 'cloth', '#33518f')
      setAppearance([id], 'legs', '#ffffff')
      expect(scene().objects[id].appearance).toEqual({ cloth: { color: '#33518f' } })
    }
  })

  it('allows body on the three napkins and rejects every other item and slot', () => {
    // The napkin() wrapper is what grants the free picker, so the catalog decides
    // who is on the list — a fourth napkin has to appear here rather than slip in.
    // decor.napkin-folded joined the other two in this round (source doc §14).
    const napkins = listCatalog()
      .filter((e) => e.materialSlots.some((s) => s.allowCustomColor))
      .map((e) => e.id)
    expect(napkins).toEqual(['decor.fabric-folded', 'decor.napkin-folded', 'decor.napkin-white'])

    const tableId = addObject('table.round', { x: 500, y: 500 })
    for (const catalogId of napkins) {
      expect(getCatalogEntry(catalogId).editableSlots?.map((s) => s.slot)).toEqual(['body'])
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

  /**
   * The regression the merge exists for. `setAppearance` used to REPLACE the slot
   * record, so picking a colour after a texture dropped the texture — and dropping
   * it does not merely blank the slot, it falls back to the catalogue default,
   * which on a napkin is a visible jump back to another weave.
   */
  it('keeps colour and texture on the same slot, in either order', () => {
    const id = addObject('table.round', { x: 800, y: 800 })
    setAppearance([id], 'cloth', '#33518f')
    setSlotTexture([id], 'cloth', 'fabric-06')
    expect(scene().objects[id].appearance).toEqual({
      cloth: { color: '#33518f', textureId: 'fabric-06' },
    })
    setAppearance([id], 'cloth', '#ffffff')
    expect(scene().objects[id].appearance).toEqual({
      cloth: { color: '#ffffff', textureId: 'fabric-06' },
    })
  })

  it('stores an explicit null rather than deleting the key', () => {
    // `null` = "no texture" and ABSENT = "the slot default" are different states,
    // and only the first survives a reload as the user's answer — on a napkin,
    // deleting the key would put the catalogue's weave straight back.
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const napkinId = addObjectToSurface('decor.napkin-white', tableId, { x: 500, y: 500 })!
    setSlotTexture([napkinId], 'body', null)
    expect(scene().objects[napkinId].appearance).toEqual({ body: { textureId: null } })
    expect('textureId' in scene().objects[napkinId].appearance.body).toBe(true)
  })

  it('refuses a non-editable slot and an unknown texture id', () => {
    const id = addObject('table.round', { x: 800, y: 800 })
    setSlotTexture([id], 'legs', 'fabric-06') // not on `editableSlots`
    setSlotTexture([id], 'cloth', 'fabric-23') // only 22 exist
    setSlotTexture([id], 'cloth', '../../etc/passwd') // a stored id becomes a URL
    expect(scene().objects[id].appearance).toEqual({})
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
    // Read the rectangle from the pack (BRIEF §1.7). It used to be copied in as
    // x[766,3962] y[1408,2544] and went stale the moment the 19:47 re-import
    // narrowed `pool` to the water alone — the table was being pushed out of the
    // real zone and still judged against the old one.
    const pool = getVenuePack('resort')!.restricted!.find((z) => z.kind === 'pool')!
    // the pool reaches the far wall (venue depth 2544), so a table dropped in it
    // must exit upward, where there is room
    const id = addObject('table.round', { x: pool.x + pool.width / 2, y: pool.y + pool.depth / 2 })
    const b = objectAABB(scene(), id)!
    const overlapsPool =
      b.minX < pool.x + pool.width && b.maxX > pool.x && b.minY < pool.y + pool.depth && b.maxY > pool.y
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

  it('drops onto a table as an attached child, pulled to the centre', () => {
    const tableId = addObject('table.round', { x: 500, y: 500 })
    const decorId = addObjectToSurface(DECOR, tableId, { x: 520, y: 510 })!
    const decor = scene().objects[decorId]
    expect(decor.parentId).toBe(tableId)
    expect(decor.attachment).toEqual({ kind: 'surface' })
    expect(decor.transform.elevation).toBe(TABLE_H)
    // source doc §28: a hand-placed centrepiece belongs in the middle of the
    // table, so the 20/10 offset of the drop point is deliberately discarded
    expect(decor.transform.position).toEqual({ x: 0, y: 0 })
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
  // (hw=hh=half the diagonal instead of half the width / half the depth), stopping
  // it short of the rim on every table. Shoved outward, a rotated decor must reach
  // its EXACT rotated extent. Turned 180° or 90°, that extent is half its depth, so
  // every expectation below is the table's own half-extent minus that — read from
  // the catalog, because the setting was resized in this round (source doc §2a).
  it('a rotated rect decor reaches the exact rim, not its circumradius', () => {
    const RECT = 'decor.place-setting'
    const halfDepth = getCatalogEntry(RECT).defaultSize.depth / 2
    const round = getCatalogEntry('table.round').defaultSize
    const banquetSize = getCatalogEntry('table.banquet').defaultSize
    const shoveTo = (childId: string, deg: number, delta: { x: number; y: number }) => {
      rotateObjectsBy([childId], deg)
      moveObjectsBy([childId], delta)
      return scene().objects[childId].transform.position
    }
    const roundId = addObject('table.round', { x: 500, y: 500 })
    const onRound = addObjectToSurface(RECT, roundId, { x: 500, y: 500 })!
    expect(shoveTo(onRound, 180, { x: 0, y: 999 }).y).toBeCloseTo(round.width / 2 - halfDepth)

    const banquet = addObject('table.banquet', { x: 1000, y: 500 })
    const onLong = addObjectToSurface(RECT, banquet, { x: 1000, y: 500 })!
    expect(shoveTo(onLong, 180, { x: 0, y: 999 }).y).toBeCloseTo(banquetSize.depth / 2 - halfDepth)
    const onEnd = addObjectToSurface(RECT, banquet, { x: 1000, y: 500 })!
    expect(shoveTo(onEnd, 90, { x: 999, y: 0 }).x).toBeCloseTo(banquetSize.width / 2 - halfDepth)
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
  /**
   * EVERY rectangle of that kind, with 1cm of slack, read off the pack rather
   * than written out. The measurements move on every SketchUp re-import —
   * 2026-07-28 15:09 deepened the bar by 50 and the DJ by 10 — and hardcoding
   * them turned a real venue change into a test failure that looked like a clamp
   * bug.
   *
   * ⚠ Plural on purpose. A `kind` may own SEVERAL rectangles, and the clamp snaps
   * to the NEAREST CENTRE (actions.ts:380-391), so which one a station lands in
   * depends on where it was dropped. This used to `find()` the first and ask
   * "is it in THAT one" — which is the same frozen-tally mistake one level up,
   * and it is exactly what the second DJ pad (2026-07-29) tripped.
   */
  const zoneBounds = (kind: string) =>
    getVenuePack('resort')!
      .restricted!.filter((r) => r.kind === kind)
      .map((z) => ({
        minX: z.x - 0.01,
        minY: z.y - 0.01,
        maxX: z.x + z.width + 0.01,
        maxY: z.y + z.depth + 0.01,
      }))

  it('a DJ booth dropped anywhere in the resort snaps into its zone and cannot leave', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const id = addObject('dj.booth', { x: 300, y: 300 }) // far from either DJ pad
    expect(scene().objects[id].transform.rotation).toBe(-180)
    const zs = zoneBounds('dj')
    // the resort has two pads since 2026-07-29; "its zone" means either of them
    expect(zs.length).toBeGreaterThan(0)
    const inZone = () => {
      const b = objectAABB(scene(), id)!
      return zs.some((z) => b.minX >= z.minX && b.maxX <= z.maxX && b.minY >= z.minY && b.maxY <= z.maxY)
    }
    expect(inZone()).toBe(true)
    moveObjectsBy([id], { x: -2000, y: -1000 })
    expect(inZone()).toBe(true)
    moveObjectsBy([id], { x: 9999, y: 9999 })
    expect(inZone()).toBe(true)
  })

  /**
   * Two DJ pads are only a feature if a booth can actually be sent to either one.
   * The clamp picks the NEAREST CENTRE, so the booth is dropped on one pad and
   * then walked across the watershed to the other and back.
   *
   * Every coordinate is derived from the pack and the pads are told apart by x,
   * not by array position: the array order is load-bearing for other reasons
   * (venuePacks.ts) and must not become load-bearing here too.
   */
  it('a DJ booth snaps to the NEAREST pad and can be moved to the other', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const pads = [...getVenuePack('resort')!.restricted!.filter((r) => r.kind === 'dj')]
      .sort((a, b) => a.x - b.x)
    expect(pads).toHaveLength(2)
    const [west, east] = pads
    const centre = (z: RestrictedZone) => ({ x: z.x + z.width / 2, y: z.y + z.depth / 2 })
    const inPad = (id: string, z: RestrictedZone) => {
      const b = objectAABB(scene(), id)!
      return (
        b.minX >= z.x - 0.01 && b.maxX <= z.x + z.width + 0.01 &&
        b.minY >= z.y - 0.01 && b.maxY <= z.y + z.depth + 0.01
      )
    }
    const span = centre(east).x - centre(west).x

    const id = addObject('dj.booth', centre(west))
    expect(inPad(id, west)).toBe(true)
    expect(inPad(id, east)).toBe(false)

    moveObjectsBy([id], { x: span, y: 0 })
    expect(inPad(id, east)).toBe(true)

    moveObjectsBy([id], { x: -span, y: 0 })
    expect(inPad(id, west)).toBe(true)
  })

  it('a bar unit lives only inside the bar zone', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const id = addObject('bar.resort-left', { x: 4000, y: 2400 })
    const b = objectAABB(scene(), id)!
    const zs = zoneBounds('bar')
    // one bar rectangle today, so the per-axis assertions below stay readable.
    // A second one would make this fail HERE, pointing at the .some() treatment
    // the DJ case above already has, rather than failing as a mystery clamp bug.
    expect(zs).toHaveLength(1)
    const [z] = zs
    expect(b.minX).toBeGreaterThanOrEqual(z.minX)
    expect(b.maxX).toBeLessThanOrEqual(z.maxX)
    expect(b.minY).toBeGreaterThanOrEqual(z.minY)
    expect(b.maxY).toBeLessThanOrEqual(z.maxY)
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
    // nothing could ever hang over the dance floor. It lands on a beam crossing
    // rather than the exact drop point (source doc §12), so assert containment.
    newProject({ name: 'resort', venuePackId: 'resort' })
    const zone = getVenuePack('resort')!.restricted!.find((z) => z.kind === 'dancefloor')!
    const at = { x: zone.x + zone.width / 2, y: zone.y + zone.depth / 2 }
    const id = addObject('lamp.chandelier-diamond', at)
    const { x, y } = scene().objects[id].transform.position
    expect(x).toBeGreaterThanOrEqual(zone.x)
    expect(x).toBeLessThanOrEqual(zone.x + zone.width)
    expect(y).toBeGreaterThanOrEqual(zone.y)
    expect(y).toBeLessThanOrEqual(zone.y + zone.depth)
  })

  it('a ceiling fixture snaps to the nearest beam crossing', () => {
    // source doc §12: "they cannot be left hanging in the air" — the drop point
    // is pulled onto the truss grid, not just kept inside the venue.
    newProject({ name: 'resort', venuePackId: 'resort' })
    const beams = getVenuePack('resort')!.ceilingBeams!
    const xs = beams.find((b) => b.axis === 'y')!.positions
    const ys = beams.find((b) => b.axis === 'x')!.positions
    // A hair off a real crossing on BOTH axes — inside CROSSING_SNAP either way, so
    // the drop is pulled onto the crossing instead of sliding along one beam. The
    // literal (1000, 200) this used to drop at only landed on a crossing because
    // the old x family had a row at 190; it now has three rows at 102/704/1306 and
    // the same point legitimately slides. Probe from the grid, never at it.
    const id = addObject('lamp.chandelier-diamond', { x: xs[2] + 8, y: ys[1] + 10 })
    const { x, y } = scene().objects[id].transform.position
    expect(xs).toContain(x)
    expect(ys).toContain(y)
  })
})

describe('hall layouts', () => {
  const LAYOUT = HALL_LAYOUTS[0]

  it('places the authored tables seated and tagged, in one undo entry', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const ids = applyHallLayout(LAYOUT.id)
    expect(ids).toHaveLength(LAYOUT.placements.length)
    const first = scene().objects[ids[0]]
    expect(first.meta.layoutTables).toBe(LAYOUT.id)
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

  /**
   * Source doc §22 — the submenu picks a chair and a design for the layout it is
   * about to apply. Both are read out of the registries rather than spelled out
   * here: the preset's baked chair and the design's contents both move between
   * rounds, and a frozen copy in the test would only fail later for the wrong
   * reason (BRIEF §1.7).
   */
  it('applies a chair override and a design to every table it places', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const baked = getTablePreset(LAYOUT.placements[0].presetId)!.chairCatalogId
    const other = listByCategory('seating').find((c) => c.id !== baked)!
    const design = TABLE_DESIGNS[0]

    const ids = applyHallLayout(LAYOUT.id, { chairCatalogId: other.id, designId: design.id })

    expect(ids).toHaveLength(LAYOUT.placements.length)
    for (const id of ids) {
      expect(scene().objects[id].seating!.chairCatalogId).toBe(other.id)
      expect(attachedChairs(scene(), id).map((c) => c.catalogId)).not.toContain(baked)
      expect(designItems(scene(), id).length).toBeGreaterThan(0)
    }
  })

  /** The whole apply — tables, overridden chairs and decor — is ONE undo entry. */
  it('undoes a layout applied with options in a single step', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const other = listByCategory('seating')[1]
    applyHallLayout(LAYOUT.id, { chairCatalogId: other.id, designId: TABLE_DESIGNS[0].id })
    expect(Object.values(scene().objects).some((o) => o.meta.design !== undefined)).toBe(true)

    undo()

    expect(hasHallLayout(scene())).toBe(false)
    expect(Object.values(scene().objects).some((o) => o.meta.design !== undefined)).toBe(false)
  })

  /** A chair the catalog does not have is ignored, not thrown on: the mutation
   *  would be discarded whole, leaving the previous layout deleted and nothing
   *  in its place. */
  it('falls back to the preset chair when the override is not a real catalog id', () => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    const baked = getTablePreset(LAYOUT.placements[0].presetId)!.chairCatalogId
    const ids = applyHallLayout(LAYOUT.id, { chairCatalogId: 'chair.does-not-exist' })
    expect(ids).toHaveLength(LAYOUT.placements.length)
    expect(scene().objects[ids[0]].seating!.chairCatalogId).toBe(baked)
  })
})
