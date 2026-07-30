/**
 * The round-4 pointer selectors.
 *
 * Every one of them answers a question BOTH renderers ask — may I highlight this,
 * may I drag it, may I turn it, what may this menu offer — and the recurring bug
 * in this repo is a rule wired into one renderer and not the other. So the shape
 * of this file is: state the rule once, then run the same eight scene conditions
 * past it. The eight are the ones that have actually caused bugs — frozen, own
 * lock, layer lock, hidden, hidden by an ancestor, muted by design-edit, the
 * isolated table itself, and an ordinary object.
 *
 * `LOCKABLE_LAYER` and the catalog ids are read from the catalog, not asserted
 * against a remembered value: the layer keys grew from six to twelve across two
 * schema versions and a frozen constant would have gone quietly wrong.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import type { Id } from '../core/model/types'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  newProject,
  setLayerHidden,
  setLayerLocked,
  setLocked,
  setSeatingConfig,
} from './actions'
import {
  canEditTable,
  canMoveObject,
  canRotateObject,
  isEffectivelyLocked,
  isHoverable,
  menuCapabilities,
  seatBounds,
  selectedTable,
} from './selectors'
import { useEditorStore } from './store'

const TABLE = 'table.round'
const KNIGHTS = 'table.knights-480'
const DECOR = 'decor.candelabra-crystal'
const SETTING = 'decor.place-setting'
const PLANT = 'plant.potted-2'

const scene = () => useEditorStore.getState().scene
const layerOf = (catalogId: string) => getCatalogEntry(catalogId).category

/** A baked venue fixture, exactly as `createDefaultScene` seeds one. */
function freeze(id: Id): void {
  useEditorStore.setState((state) => {
    state.scene.objects[id].flags = { locked: true, visible: true, frozen: true }
  })
}

function hide(id: Id): void {
  useEditorStore.setState((state) => {
    state.scene.objects[id].flags.visible = false
  })
}

/** The first attached chair of a table — the drill-in target. */
function chairOf(tableId: Id): Id {
  const chair = Object.values(scene().objects).find(
    (o) => o.parentId === tableId && o.attachment?.kind === 'seat',
  )
  if (!chair) throw new Error(`no chair attached to ${tableId}`)
  return chair.id
}

let table: Id
let plant: Id

beforeEach(() => {
  newProject({ name: 'selectors', venueWidth: 4000, venueDepth: 3000 })
  table = addObject(TABLE, { x: 1000, y: 1000 })
  plant = addObject(PLANT, { x: 300, y: 300 })
})

describe('isHoverable', () => {
  it('says yes to an ordinary object', () => {
    expect(isHoverable(scene(), plant, null)).toBe(true)
    expect(isHoverable(scene(), table, null)).toBe(true)
  })

  it('says no to an id that is not there', () => {
    expect(isHoverable(scene(), 'no-such-object', null)).toBe(false)
  })

  it('says no to a frozen fixture', () => {
    freeze(plant)
    expect(isHoverable(scene(), plant, null)).toBe(false)
  })

  it('says no to an object the user locked', () => {
    setLocked([plant], true)
    expect(isHoverable(scene(), plant, null)).toBe(false)
    setLocked([plant], false)
    expect(isHoverable(scene(), plant, null)).toBe(true)
  })

  it('says no when the layer is locked', () => {
    setLayerLocked(layerOf(PLANT), true)
    expect(isHoverable(scene(), plant, null)).toBe(false)
    setLayerLocked(layerOf(PLANT), false)
    expect(isHoverable(scene(), plant, null)).toBe(true)
  })

  it('says no when the object is hidden, or its layer is', () => {
    hide(plant)
    expect(isHoverable(scene(), plant, null)).toBe(false)

    setLayerHidden(layerOf(TABLE), true)
    expect(isHoverable(scene(), table, null)).toBe(false)
    setLayerHidden(layerOf(TABLE), false)
    expect(isHoverable(scene(), table, null)).toBe(true)
  })

  /** Hiding the tables layer hides the chairs standing at them, so nothing there hovers. */
  it('says no to a child hidden by its ancestor', () => {
    const chair = chairOf(table)
    expect(isHoverable(scene(), chair, null)).toBe(true)

    setLayerHidden(layerOf(TABLE), true)
    expect(isHoverable(scene(), chair, null)).toBe(false)
  })

  describe('inside design-edit mode', () => {
    it('keeps the isolated table live and mutes every other top-level object', () => {
      const other = addObject(TABLE, { x: 2500, y: 1000 })
      expect(isHoverable(scene(), table, table)).toBe(true)
      expect(isHoverable(scene(), other, table)).toBe(false)
      expect(isHoverable(scene(), plant, table)).toBe(false)
    })

    /**
     * The clause `isDesignEditMuted` cannot express on its own: a CHILD is judged
     * by the table it hangs off. Its own id never equals the edited table's, so
     * asking directly would mute the very china the mode was opened to arrange.
     */
    it('judges a child by the table it belongs to', () => {
      const other = addObject(TABLE, { x: 2500, y: 1000 })
      const mine = addObjectToSurface(DECOR, table, { x: 1000, y: 1000 })!
      const theirs = addObjectToSurface(DECOR, other, { x: 2500, y: 1000 })!

      expect(isHoverable(scene(), mine, table)).toBe(true)
      expect(isHoverable(scene(), theirs, table)).toBe(false)
      expect(isHoverable(scene(), chairOf(table), table)).toBe(true)
      expect(isHoverable(scene(), chairOf(other), table)).toBe(false)
    })

    /** It takes the RAW store field, so a stale id must be unobservable here too. */
    it('mutes nothing when the stored id is not an open session', () => {
      expect(isHoverable(scene(), plant, table)).toBe(false) // a real session mutes…
      expect(isHoverable(scene(), plant, 'deleted-table-id')).toBe(true) // …a dead id does not
      expect(isHoverable(scene(), plant, plant)).toBe(true) // nor does a non-table
      setLayerHidden(layerOf(TABLE), true)
      expect(isHoverable(scene(), plant, table)).toBe(true) // hidden table = no session
    })
  })
})

describe('canMoveObject', () => {
  it('says yes to an ordinary top-level object', () => {
    expect(canMoveObject(scene(), plant)).toBe(true)
  })

  it('says no to a missing id, a frozen fixture, a locked object and a locked layer', () => {
    expect(canMoveObject(scene(), 'no-such-object')).toBe(false)

    freeze(plant)
    expect(canMoveObject(scene(), plant)).toBe(false)

    setLocked([table], true)
    expect(canMoveObject(scene(), table)).toBe(false)
    setLocked([table], false)

    setLayerLocked(layerOf(TABLE), true)
    expect(canMoveObject(scene(), table)).toBe(false)
  })

  /** Hidden is NOT part of it: what cannot be seen cannot be dragged in the first
   *  place, and `dragController` filters on visibility separately when collecting
   *  snap targets. Keeping this rule exactly as the drag filter states it is the
   *  point of extracting it. */
  it('does not ask about visibility', () => {
    hide(plant)
    expect(canMoveObject(scene(), plant)).toBe(true)
  })

  /** The clause that separates it from canRotateObject. */
  it('says no to an attached child, however unlocked it is', () => {
    expect(canMoveObject(scene(), chairOf(table))).toBe(false)
    const decor = addObjectToSurface(DECOR, table, { x: 1000, y: 1000 })!
    expect(canMoveObject(scene(), decor)).toBe(false)
  })

  /** Byte-equivalent to the filter at dragController.ts, restated as the oracle. */
  it('matches the drag filter it was lifted from', () => {
    setLocked([plant], true)
    const decor = addObjectToSurface(DECOR, table, { x: 1000, y: 1000 })!
    for (const id of [table, plant, decor, chairOf(table), 'no-such-object']) {
      const o = scene().objects[id]
      expect(canMoveObject(scene(), id)).toBe(!!o && !o.parentId && !isEffectivelyLocked(scene(), o))
    }
  })
})

describe('canRotateObject', () => {
  it('says yes to an ordinary object', () => {
    expect(canRotateObject(scene(), plant)).toBe(true)
  })

  it('says no to a missing id, a frozen fixture, a locked object and a locked layer', () => {
    expect(canRotateObject(scene(), 'no-such-object')).toBe(false)

    freeze(plant)
    expect(canRotateObject(scene(), plant)).toBe(false)

    setLocked([table], true)
    expect(canRotateObject(scene(), table)).toBe(false)
    setLocked([table], false)

    setLayerLocked(layerOf(TABLE), true)
    expect(canRotateObject(scene(), table)).toBe(false)
  })

  /**
   * The asymmetry with `canMoveObject`, stated as a test so it cannot be
   * "tidied up" into one predicate: `rotateObjectsBy` lets a child through
   * without even a pose probe, because a drilled-in chair is angled at its seat.
   */
  it('says YES to an attached child, unlike canMoveObject', () => {
    const chair = chairOf(table)
    expect(canRotateObject(scene(), chair)).toBe(true)
    expect(canMoveObject(scene(), chair)).toBe(false)
  })
})

describe('canEditTable', () => {
  it('says yes to a table and no to anything else', () => {
    expect(canEditTable(scene(), table)).toBe(true)
    expect(canEditTable(scene(), plant)).toBe(false)
    expect(canEditTable(scene(), chairOf(table))).toBe(false)
    expect(canEditTable(scene(), 'no-such-object')).toBe(false)
  })

  it('says no to a hidden table — the mode would close on itself', () => {
    setLayerHidden(layerOf(TABLE), true)
    expect(canEditTable(scene(), table)).toBe(false)
    setLayerHidden(layerOf(TABLE), false)
    expect(canEditTable(scene(), table)).toBe(true)
  })

  /** Locking pins the TABLE; the decor on it is other objects with their own flags. */
  it('still says yes to a locked table', () => {
    setLocked([table], true)
    expect(canEditTable(scene(), table)).toBe(true)
    expect(canMoveObject(scene(), table)).toBe(false)
  })
})

describe('selectedTable', () => {
  it('is the one selected table', () => {
    expect(selectedTable(scene(), [table])).toBe(table)
  })

  it('is null for no selection, several, or a non-table', () => {
    expect(selectedTable(scene(), [])).toBeNull()
    expect(selectedTable(scene(), [table, addObject(TABLE, { x: 2500, y: 1000 })])).toBeNull()
    expect(selectedTable(scene(), [plant])).toBeNull()
    expect(selectedTable(scene(), ['no-such-object'])).toBeNull()
  })

  /** A selection outlives a delete until pruneSelection runs. */
  it('is null for a table that is gone', () => {
    useEditorStore.setState((state) => {
      delete state.scene.objects[table]
    })
    expect(selectedTable(scene(), [table])).toBeNull()
  })

  it('is null for a hidden table — a ring round nothing is a control over nothing', () => {
    setLayerHidden(layerOf(TABLE), true)
    expect(selectedTable(scene(), [table])).toBeNull()
    setLayerHidden(layerOf(TABLE), false)
    expect(selectedTable(scene(), [table])).toBe(table)
  })

  it('is null for an attached child', () => {
    expect(selectedTable(scene(), [chairOf(table)])).toBeNull()
  })

  /** Locked and frozen tables still have a selection; the handle asks separately. */
  it('is not about whether the table may be turned', () => {
    setLocked([table], true)
    expect(selectedTable(scene(), [table])).toBe(table)
    expect(canRotateObject(scene(), table)).toBe(false)
  })
})

describe('seatBounds', () => {
  it('is null for anything without seating', () => {
    expect(seatBounds(scene(), plant)).toBeNull()
    expect(seatBounds(scene(), chairOf(table))).toBeNull()
    expect(seatBounds(scene(), 'no-such-object')).toBeNull()
  })

  it('reads min straight off the catalog', () => {
    const cap = getCatalogEntry(TABLE).seating!
    expect(seatBounds(scene(), table)!.min).toBe(cap.min)
  })

  /** Whichever of the catalog cap and the geometry is tighter — that is the field's max. */
  it('caps max at the smaller of the catalog limit and what fits', () => {
    const cap = getCatalogEntry(TABLE).seating!
    const bounds = seatBounds(scene(), table)!
    expect(bounds.max).toBeLessThanOrEqual(cap.max)
    expect(bounds.max).toBeGreaterThanOrEqual(cap.defaultCount)

    // widening the gap fits fewer chairs, so the ceiling comes down with it
    setSeatingConfig(table, { gap: 40 })
    expect(seatBounds(scene(), table)!.max).toBeLessThan(bounds.max)
  })

  /**
   * The number the inspector's gap field is capped at. Capacity is a step
   * function of gap, so an uncapped field deletes chairs on one nudge — the
   * knights table is the sharp case (`core/layout/seatLayout.ts`).
   */
  it('gives a gap ceiling that still seats the default count', () => {
    const knights = addObject(KNIGHTS, { x: 2000, y: 2000 })
    const entry = getCatalogEntry(KNIGHTS)
    const bounds = seatBounds(scene(), knights)!
    expect(bounds.gapMax).toBeGreaterThan(0)

    setSeatingConfig(knights, { gap: bounds.gapMax })
    expect(seatBounds(scene(), knights)!.max).toBeGreaterThanOrEqual(entry.seating!.defaultCount)

    setSeatingConfig(knights, { gap: bounds.gapMax + 1 })
    expect(seatBounds(scene(), knights)!.max).toBeLessThan(entry.seating!.defaultCount)
  })

  /** A chair model retired between releases must hide one section, not throw. */
  it('is null rather than throwing when the chair model is gone', () => {
    useEditorStore.setState((state) => {
      state.scene.objects[table].seating!.chairCatalogId = 'chair.retired-in-round-2'
    })
    expect(() => seatBounds(scene(), table)).not.toThrow()
    expect(seatBounds(scene(), table)).toBeNull()
  })
})

describe('menuCapabilities', () => {
  it('offers nothing scene-related on empty canvas', () => {
    const caps = menuCapabilities(scene(), [], null)
    expect(caps.kind).toBe('canvas')
    expect(caps.ids).toEqual([])
    expect(caps.canDelete).toBe(false)
    expect(caps.canCopy).toBe(false)
  })

  it('treats a target that no longer exists as empty canvas', () => {
    expect(menuCapabilities(scene(), [table], 'no-such-object').kind).toBe('canvas')
  })

  it('offers the full set on an ordinary object', () => {
    const caps = menuCapabilities(scene(), [plant], plant)
    expect(caps).toEqual({
      kind: 'object',
      ids: [plant],
      canDuplicate: true,
      canCopy: true,
      canCut: true,
      canRotate: true,
      canReplace: true,
      canReorder: true,
      canLock: true,
      canDelete: true,
      anyLocked: false,
    })
  })

  it('acts on the whole selection when the target is part of it', () => {
    const caps = menuCapabilities(scene(), [table, plant], plant)
    expect(caps.ids).toEqual([table, plant])
    expect(caps.canReplace).toBe(false) // replace is a single-object operation
  })

  /** Stage2D selects the target first; this stays right for a caller that has not. */
  it('falls back to the target alone when the selection does not contain it', () => {
    expect(menuCapabilities(scene(), [table], plant).ids).toEqual([plant])
  })

  it('drops ids the scene no longer has', () => {
    expect(menuCapabilities(scene(), [plant, 'ghost-id'], plant).ids).toEqual([plant])
  })

  describe('a locked or frozen target', () => {
    it('cannot be replaced, cut or deleted, but can still be unlocked', () => {
      setLocked([plant], true)
      const caps = menuCapabilities(scene(), [plant], plant)
      expect(caps.canReplace).toBe(false)
      expect(caps.canDelete).toBe(false)
      expect(caps.canCut).toBe(false)
      expect(caps.canLock).toBe(true) // setLocked guards on frozen, not on locked
      expect(caps.anyLocked).toBe(true)
      expect(caps.canCopy).toBe(true) // copying mutates nothing
      expect(caps.canDuplicate).toBe(true)
    })

    it('cannot even be unlocked when it is frozen', () => {
      freeze(plant)
      const caps = menuCapabilities(scene(), [plant], plant)
      expect(caps.canLock).toBe(false)
      expect(caps.canDelete).toBe(false)
      expect(caps.canRotate).toBe(false)
      expect(caps.anyLocked).toBe(true)
    })

    it('is refused through a locked LAYER as well as its own flag', () => {
      setLayerLocked(layerOf(PLANT), true)
      const caps = menuCapabilities(scene(), [plant], plant)
      expect(caps.canDelete).toBe(false)
      expect(caps.canReplace).toBe(false)
      expect(caps.anyLocked).toBe(false) // the OBJECT is not locked — the layer is
    })

    /** A mixed selection: one entry that can act is enough to offer it. */
    it('offers what SOME of the selection can do', () => {
      freeze(plant)
      const caps = menuCapabilities(scene(), [plant, table], table)
      expect(caps.canDelete).toBe(true)
      expect(caps.canLock).toBe(true)
      expect(caps.anyLocked).toBe(true) // the frozen one carries locked: true
    })
  })

  describe('a target inside a table', () => {
    it('offers delete and nothing else for table-top decor', () => {
      const decor = addObjectToSurface(DECOR, table, { x: 1000, y: 1000 })!
      const caps = menuCapabilities(scene(), [decor], decor)
      expect(caps.kind).toBe('surfaceChild')
      expect(caps.ids).toEqual([decor])
      expect(caps.canDelete).toBe(true)
      expect(caps.canDuplicate).toBe(false)
      expect(caps.canReorder).toBe(false)
      expect(caps.canReplace).toBe(false)
      expect(caps.canRotate).toBe(false)
    })

    it('does the same for a place setting', () => {
      const [setting] = addSeatItemsToTable(SETTING, table)
      expect(menuCapabilities(scene(), [setting], setting).kind).toBe('surfaceChild')
    })

    it('tells a drilled-in chair apart from table-top decor', () => {
      const chair = chairOf(table)
      const caps = menuCapabilities(scene(), [chair], chair)
      expect(caps.kind).toBe('attachedChild')
      expect(caps.ids).toEqual([chair])
      expect(caps.canDelete).toBe(true)
    })

    it('refuses to delete a child whose layer is locked', () => {
      const chair = chairOf(table)
      setLayerLocked(layerOf(getCatalogEntry(TABLE).seating!.defaultChair), true)
      expect(menuCapabilities(scene(), [chair], chair).canDelete).toBe(false)
    })

    /** The child menu never widens to the selection — it is about the one item. */
    it('ignores the rest of the selection', () => {
      const chair = chairOf(table)
      expect(menuCapabilities(scene(), [table, plant, chair], chair).ids).toEqual([chair])
    })
  })
})
