/**
 * Design-edit mode (PLAN-07, source doc §11 + §52) seen from the state layer.
 *
 * Two claims are worth more than the rest and the file is built around them:
 *
 *  - `designEditTableId` is a VIEW preference. Nothing in `actions.ts` clears it,
 *    on purpose, so every reader goes through `designEditTable(scene, id)` and a
 *    leftover id is not observable. The tests below delete the table and swap the
 *    project without touching the field, which is exactly what the app does.
 *  - Dragging a table-top item is gated like everything else. `moveObjectsBy` is
 *    the ONLY path the 2D drag takes, it speaks WORLD deltas while a child's
 *    position is parent-local, and the conversion happens twice (once to probe,
 *    once to apply). A rotated table is therefore not a nicety here — it is the
 *    only case that can tell a correct round-trip from a double rotation.
 *
 * Distances come from the catalog, never from a literal: the place setting has
 * been rescaled once already, and a copied number would keep this file green
 * while it stopped testing anything.
 */
import type { KonvaEventObject } from 'konva/lib/Node'
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { onChildDblClick, onObjectDblClick } from '../editor2d/dragController'
import type { Vec2 } from '../core/model/types'
import { composeTransform, rotateVec } from '../core/space'
import {
  addObject,
  addObjectToSurface,
  beginGesture,
  endGesture,
  moveObjectsBy,
  newProject,
  removeObjects,
  setLayerHidden,
  setRotation,
  undo,
} from './actions'
import { designEditIds, designEditTable, isDesignEditMuted, isTable } from './selectors'
import { setDesignEditTable, temporalStore, useEditorStore } from './store'

const state = () => useEditorStore.getState()
const scene = () => state().scene

const TABLE = 'table.round'
/** centre-anchored: §28 parks it in the middle whatever the pointer said */
const DECOR = 'decor.candelabra-crystal'
/** free-anchored, so it is judged (and moved) exactly where it is put */
const SETTING = 'decor.place-setting'

const outlineR = (catalogId: string): number => {
  const entry = getCatalogEntry(catalogId)
  const outline = entry.footprint(entry.defaultSize).outline
  if (outline.kind !== 'circle') throw new Error(`${catalogId} is not round`)
  return outline.r
}

/** Centre distance at which a square-on setting touches a centrepiece in the middle. */
const REACH = outlineR(DECOR) + getCatalogEntry(SETTING).defaultSize.width / 2
const CLEAR = REACH + 10

/** A table-top child at an exact parent-local spot, placed the way a drop places it. */
const childAt = (catalogId: string, tableId: string, local: Vec2): string => {
  const world = composeTransform(scene().objects[tableId].transform, {
    position: local,
    rotation: 0,
    elevation: 0,
  })
  const id = addObjectToSurface(catalogId, tableId, world.position)
  if (!id) throw new Error(`could not attach ${catalogId}`)
  return id
}

beforeEach(() => {
  newProject({ name: 'design edit', venueWidth: 4000, venueDepth: 3000 })
  setDesignEditTable(null)
})

/**
 * The double-click handlers themselves. They are the only entry point the user
 * has, and the one the verification script drives, so "which node swallowed the
 * event" is worth a test rather than a comment. Konva is a type-only import in
 * `dragController`, so a bare object with a settable `cancelBubble` is the whole
 * event these two read.
 */
describe('the way in', () => {
  const dbl = () => ({ cancelBubble: false }) as unknown as KonvaEventObject<MouseEvent>
  const open = () => designEditTable(scene(), state().designEditTableId)

  it('opens on a table', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    onObjectDblClick(table, dbl())
    expect(open()).toBe(table)
  })

  it('does nothing on anything that is not a table', () => {
    const plant = addObject('plant.potted-2', { x: 500, y: 500 })
    onObjectDblClick(plant, dbl())
    expect(open()).toBeNull()
  })

  /**
   * The trap: every `placement: 'surface'` entry is `surfaceAnchor: 'center'`, so
   * a hand-placed centrepiece sits exactly on the middle of the table — where
   * anyone aiming at "the table" clicks. The child cancels the bubble, so the
   * table's own handler never runs and the gesture used to do nothing at all.
   */
  it('opens on the PARENT when the aim lands on its decor, and keeps the decor selected', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const middle = childAt(DECOR, table, { x: 0, y: 0 })
    expect(scene().objects[middle].transform.position).toEqual({ x: 0, y: 0 }) // dead centre

    onChildDblClick(middle, dbl())

    expect(open()).toBe(table)
    expect(state().selection).toEqual([middle])
  })

  /** PLAN-05 builds on chair drill-in; the surface branch must not reach it. */
  it('still only drills into a chair, without opening the mode', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const chair = Object.values(scene().objects).find(
      (o) => o.parentId === table && o.attachment?.kind === 'seat',
    )!
    onChildDblClick(chair.id, dbl())

    expect(open()).toBeNull()
    expect(state().selection).toEqual([chair.id])
  })
})

describe('what may be isolated', () => {
  it('is a table — the entry that carries `seating`', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    expect(isTable(scene().objects[table])).toBe(true)
    expect(designEditTable(scene(), table)).toBe(table)
  })

  it('is not a chair, a plant, or nothing at all', () => {
    const plant = addObject('plant.potted-2', { x: 500, y: 500 })
    expect(isTable(scene().objects[plant])).toBe(false)
    expect(designEditTable(scene(), plant)).toBeNull()
    expect(designEditTable(scene(), null)).toBeNull()
    expect(designEditTable(scene(), 'no-such-object')).toBeNull()
  })

  it('is not an attached child, even one whose entry has seating', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const chair = Object.values(scene().objects).find((o) => o.parentId === table)
    expect(chair).toBeDefined()
    expect(designEditTable(scene(), chair!.id)).toBeNull()
  })

  /** A hidden layer leaves nothing on screen to isolate; a dimmed plan around an
   *  invisible table reads as a rendering fault rather than as a mode. */
  it('is not a table whose layer has been switched off', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    setDesignEditTable(table)
    setLayerHidden('tables', true)
    expect(designEditTable(scene(), state().designEditTableId)).toBeNull()
    setLayerHidden('tables', false)
    expect(designEditTable(scene(), state().designEditTableId)).toBe(table)
  })
})

/**
 * The read-side guard, stated as the two events that would otherwise strand the
 * mode. Neither test clears the field itself — that is the point: `removeObjects`
 * and `loadProject` live in `actions.ts`, which PLAN-07/A1 does not own, and the
 * mode survives being merged with whatever they end up doing.
 */
describe('a session that outlives its table', () => {
  it('closes when the table is deleted, without anyone clearing the field', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    setDesignEditTable(table)
    expect(designEditTable(scene(), state().designEditTableId)).toBe(table)

    removeObjects([table])
    expect(state().designEditTableId).toBe(table) // the raw field is untouched…
    expect(designEditTable(scene(), state().designEditTableId)).toBeNull() // …and unobservable
  })

  it('closes when another project is loaded', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    setDesignEditTable(table)

    newProject({ name: 'somewhere else', venueWidth: 2000, venueDepth: 2000 })
    expect(state().designEditTableId).toBe(table)
    expect(designEditTable(scene(), state().designEditTableId)).toBeNull()
  })
})

describe('the isolated group', () => {
  it('is the table followed by its children, and is empty when no session is open', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const decor = childAt(SETTING, table, { x: CLEAR, y: 0 })
    const chairs = Object.values(scene().objects).filter(
      (o) => o.parentId === table && o.attachment?.kind === 'seat',
    )
    expect(chairs.length).toBeGreaterThan(0)

    const ids = designEditIds(scene(), table)
    expect(ids[0]).toBe(table)
    expect(ids).toContain(decor)
    for (const chair of chairs) expect(ids).toContain(chair.id)
    expect(ids.length).toBe(1 + chairs.length + 1)

    expect(designEditIds(scene(), null)).toEqual([])
  })

  it('mutes every other top-level object, and nothing at all outside the mode', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const other = addObject(TABLE, { x: 2000, y: 1000 })
    // composed exactly as the renderer composes it: validate once, ask per node
    const open = designEditTable(scene(), table)
    expect(isDesignEditMuted(open, other)).toBe(true)
    expect(isDesignEditMuted(open, table)).toBe(false)
    expect(isDesignEditMuted(designEditTable(scene(), null), other)).toBe(false)
  })

  /** A deleted table stops muting the plan — the same read-side guard, seen from
   *  the renderer's side: the mode cannot leave the hall greyed out behind it. */
  it('stops muting once the isolated table is gone', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const other = addObject(TABLE, { x: 2000, y: 1000 })
    setDesignEditTable(table)
    removeObjects([table])
    expect(isDesignEditMuted(designEditTable(scene(), state().designEditTableId), other)).toBe(false)
  })
})

/**
 * §320 of the plan, and the reason the field sits outside `scene`: undoing a
 * decor move must put the decor back WITHOUT closing the editor around it.
 */
describe('the mode is a view preference, not scene data', () => {
  it('neither dirties the project nor spends an undo entry', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    useEditorStore.setState({ dirty: false })
    const history = temporalStore.getState().pastStates.length

    setDesignEditTable(table)

    expect(state().dirty).toBe(false)
    expect(temporalStore.getState().pastStates.length).toBe(history)
  })

  it('survives an undo of the very move it was opened to make', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    setDesignEditTable(table)

    beginGesture()
    moveObjectsBy([setting], { x: 0, y: 30 })
    endGesture()
    expect(scene().objects[setting].transform.position.y).toBeCloseTo(30, 6)

    undo()
    expect(scene().objects[setting].transform.position.y).toBeCloseTo(0, 6)
    expect(designEditTable(scene(), state().designEditTableId)).toBe(table)
  })
})

/**
 * `dragController.onChildDragMove` reads a parent-LOCAL node position, rotates it
 * into world by the parent's rotation and hands that to `moveObjectsBy`, which
 * rotates it back. `allowedDelta` does the same conversion once more to probe.
 * Getting one of the three wrong looks like "the collision is imprecise", not
 * like a conversion bug — hence the rotated table.
 */
describe('dragging one item out of a table design', () => {
  const dragChild = (childId: string, localDelta: Vec2) => {
    const parentId = scene().objects[childId].parentId!
    const parentRotation = scene().objects[parentId].transform.rotation
    beginGesture()
    moveObjectsBy([childId], rotateVec(localDelta, parentRotation))
    endGesture()
  }

  it('stops it on its neighbour instead of letting it through', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const middle = childAt(DECOR, table, { x: 0, y: 0 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    expect(scene().objects[middle].transform.position).toEqual({ x: 0, y: 0 })

    dragChild(setting, { x: -CLEAR, y: 0 }) // aimed straight at the centrepiece

    const at = scene().objects[setting].transform.position
    expect(at.x).toBeLessThan(CLEAR) // it did travel
    expect(at.x).toBeGreaterThan(REACH - 0.5) // and stopped where the two touch
    expect(at.x).toBeLessThan(REACH + 0.5)
    expect(scene().objects[middle].transform.position).toEqual({ x: 0, y: 0 })
  })

  it('lands on the same local spot when the table is turned', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    setRotation(table, 90)
    expect(scene().objects[table].transform.rotation).toBe(90)
    childAt(DECOR, table, { x: 0, y: 0 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    expect(scene().objects[setting].transform.position.x).toBeCloseTo(CLEAR, 6)

    dragChild(setting, { x: -CLEAR, y: 0 })

    // A second rotation anywhere in the round trip would send it sideways: the
    // y stays put and the x stops at contact, in the PARENT's frame.
    const at = scene().objects[setting].transform.position
    expect(at.y).toBeCloseTo(0, 6)
    expect(at.x).toBeGreaterThan(REACH - 0.5)
    expect(at.x).toBeLessThan(REACH + 0.5)
  })

  it('moves the item, never the table under it', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    const was = { ...scene().objects[table].transform.position }

    dragChild(setting, { x: 0, y: 25 })

    expect(scene().objects[table].transform.position).toEqual(was)
    expect(scene().objects[setting].transform.position.y).toBeCloseTo(25, 6)
  })
})
