/**
 * Editing a SELECTION of tables — round 5, the user's report: *"גם בעורך הדו מימד
 * כשאני בוחר מספר פריטים התפריט השמאלי לא מאפשר לי לערוך אותם"*.
 *
 * Two claims carry this file, and everything else is detail:
 *
 *  - ONE GESTURE IS ONE UNDO ENTRY. Every plural action is a single `mutateScene`,
 *    so `pastStates` must grow by exactly one no matter how many tables were
 *    dressed, and one `undo()` must return all of them. This is testable precisely
 *    because it is NOT a `beginGesture`/`endGesture` bracket — those are DOM-time
 *    behaviour that no node test can see, and `endGesture` is not idempotent, so a
 *    loop inside a bracket silently degrades into N entries. Being a single
 *    mutation is what makes the claim checkable at all.
 *  - "APPLY TO THE SELECTED" AND "APPLY TO THE WHOLE HALL" ARE ONE IMPLEMENTATION.
 *    Not asserted by reading the source but by driving both and comparing: the
 *    hall-wide route must equal the explicit route over `floorTableIds`.
 *
 * ⚠ `vite.config.ts` fixes `environment: 'node'` and `include: ['src/**\/*.test.ts']`,
 * so there is no DOM here and there cannot be. That constraint is what pushed
 * every decision this round into `actions.ts` and `selectionEditing`; what is left
 * in the components is rendering, and it is covered by screenshots, not by this.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { getTableDesign } from '../core/presets'
import { createTableDesignLayout } from '../core/savedLayouts'
import type { Id } from '../core/model/types'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  addSeatItemsToTables,
  addSeatsBy,
  applySavedTableDesignTo,
  applyTableDesign,
  applyTableDesignTo,
  applyTableDesignToAll,
  designItems,
  floorTableIds,
  newProject,
  removeSeatItems,
  removeSeatItemsFrom,
  removeTableDesign,
  removeTableDesignFrom,
  seatItems,
  setChairModel,
  setLayerLocked,
  setLocked,
  setObjectsRotation,
} from './actions'
import { useOverlayStore } from '../editor2d/overlayStore'
import { temporalStore, useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const history = () => temporalStore.getState().pastStates.length
const undo = () => temporalStore.getState().undo()

const TABLE = 'table.round'
const BIG = 'table.round-large'
const DESIGN = getTableDesign('design.classic-gold')!
const COVER = 'decor.place-setting'
/** laid ON a cover (§27) — the piece that makes a bare table refuse */
const NAPKIN = 'decor.napkin-white'
const CHAIR = 'chair.gold-white'

/** Three ordinary round tables, far enough apart that nothing is refused. */
let a: Id
let b: Id
let c: Id

beforeEach(() => {
  newProject({ name: 'multi', venueWidth: 4000, venueDepth: 4000 })
  a = addObject(TABLE, { x: 600, y: 600 })
  b = addObject(TABLE, { x: 1600, y: 600 })
  c = addObject(TABLE, { x: 2600, y: 600 })
})

describe('applyTableDesignTo', () => {
  it('dresses exactly the tables it was given and leaves the rest bare', () => {
    applyTableDesignTo(DESIGN.id, [a, b])
    expect(designItems(scene(), a).length).toBeGreaterThan(0)
    expect(designItems(scene(), b).length).toBeGreaterThan(0)
    expect(designItems(scene(), c)).toHaveLength(0)
  })

  it('costs ONE undo entry for the whole selection', () => {
    const before = history()
    applyTableDesignTo(DESIGN.id, [a, b, c])
    expect(history()).toBe(before + 1)

    undo()
    for (const id of [a, b, c]) expect(designItems(scene(), id)).toHaveLength(0)
  })

  it('is the same implementation as apply-to-all, driven with the full list', () => {
    const viaAll = applyTableDesignToAll(DESIGN.id)
    undo()
    const viaList = applyTableDesignTo(DESIGN.id, floorTableIds(scene()))
    expect(viaList).toHaveLength(viaAll.length)
    const tablesOf = (ids: Id[]) => new Set(ids.map((id) => scene().objects[id]?.parentId))
    expect(tablesOf(viaList).size).toBe(3)
  })

  it('apply-to-all still reaches a table that is NOT in the selection', () => {
    applyTableDesignToAll(DESIGN.id)
    for (const id of [a, b, c]) expect(designItems(scene(), id).length).toBeGreaterThan(0)
  })

  it('skips a locked table and dresses the others', () => {
    setLocked([b], true)
    applyTableDesignTo(DESIGN.id, [a, b, c])
    expect(designItems(scene(), a).length).toBeGreaterThan(0)
    expect(designItems(scene(), b)).toHaveLength(0)
    expect(designItems(scene(), c).length).toBeGreaterThan(0)
  })

  it('writes nothing when every selected table is locked — by its own flag or its layer', () => {
    setLayerLocked(getCatalogEntry(TABLE).category, true)
    expect(applyTableDesignTo(DESIGN.id, [a, b, c])).toHaveLength(0)
    for (const id of [a, b, c]) expect(designItems(scene(), id)).toHaveLength(0)
  })

  it('a saved design rescales to EACH target, not to the one it was captured on', () => {
    const big = addObject(BIG, { x: 2600, y: 2600 })
    applyTableDesign(DESIGN.id, a)
    const captured = createTableDesignLayout('captured', scene(), a)!
    // the small table is the yardstick: the same layout on the ⌀380 must push its
    // pieces further out, because `designFromSavedLayout` scales by the size ratio
    applySavedTableDesignTo(captured, [b, big])
    const reach = (id: Id) =>
      Math.max(
        ...designItems(scene(), id).map((o) => Math.hypot(o.transform.position.x, o.transform.position.y)),
      )
    expect(reach(big)).toBeGreaterThan(reach(b))
  })
})

describe('removeTableDesignFrom', () => {
  it('clears the tagged decor off every table and spares what was placed by hand', () => {
    applyTableDesignTo(DESIGN.id, [a, b])
    const manual = addObjectToSurface('decor.vase-ceramic', a, { x: 600, y: 630 })!
    const before = history()
    removeTableDesignFrom([a, b])
    expect(history()).toBe(before + 1)
    expect(designItems(scene(), a)).toHaveLength(0)
    expect(designItems(scene(), b)).toHaveLength(0)
    expect(scene().objects[manual]).toBeDefined()
  })

  it('the single-table name is the same call with one id', () => {
    applyTableDesignTo(DESIGN.id, [a, b])
    removeTableDesign(a)
    expect(designItems(scene(), a)).toHaveLength(0)
    expect(designItems(scene(), b).length).toBeGreaterThan(0)
  })
})

describe('addSeatItemsToTables', () => {
  it('lays a cover at every seat of every table, in one undo entry', () => {
    const before = history()
    addSeatItemsToTables(COVER, [a, b, c])
    expect(history()).toBe(before + 1)
    for (const id of [a, b, c]) expect(seatItems(scene(), id).length).toBeGreaterThan(0)

    undo()
    for (const id of [a, b, c]) expect(seatItems(scene(), id)).toHaveLength(0)
  })

  it('is what the single-table name calls — same result for a list of one', () => {
    addSeatItemsToTable(COVER, a)
    const viaSingle = seatItems(scene(), a).length
    addSeatItemsToTables(COVER, [b])
    expect(seatItems(scene(), b)).toHaveLength(viaSingle)
  })

  /**
   * ⚠ THE REFUSAL LEAK. `laySeatItems` writes the module-level `refusal` when a
   * napkin finds no cover under it, and `mutateScene` publishes whatever is
   * pending at the end of the gesture. Table `c` here has no covers, so without
   * `refusal = null` the pill would blame a gesture that dressed two tables.
   */
  it('one table with nothing to lay on does not cancel the tables that worked', () => {
    addSeatItemsToTables(COVER, [a, b])
    useOverlayStore.setState({ violation: null })

    const laid = addSeatItemsToTables(NAPKIN, [a, b, c])

    expect(laid.length).toBeGreaterThan(0)
    expect(seatItems(scene(), a).length).toBeGreaterThan(seatItems(scene(), c).length)
    // the bare table raised `missingHost` inside the same mutation; the gesture
    // dressed two tables, so nothing is reported
    expect(useOverlayStore.getState().violation).toBeNull()
  })

  it('…and still reports it when NOTHING was laid at all', () => {
    useOverlayStore.setState({ violation: null })
    expect(addSeatItemsToTables(NAPKIN, [a, b, c])).toHaveLength(0)
    expect(useOverlayStore.getState().violation).not.toBeNull()
  })

  it('skips a locked table and lays on the free ones', () => {
    setLocked([a], true)
    addSeatItemsToTables(COVER, [a, b])
    expect(seatItems(scene(), a)).toHaveLength(0)
    expect(seatItems(scene(), b).length).toBeGreaterThan(0)
  })
})

describe('removeSeatItemsFrom', () => {
  it('clears every table in one entry and takes the napkins riding the covers', () => {
    addSeatItemsToTables(COVER, [a, b])
    addSeatItemsToTables(NAPKIN, [a, b])
    const before = history()
    removeSeatItemsFrom([a, b])
    expect(history()).toBe(before + 1)
    for (const id of [a, b]) expect(seatItems(scene(), id)).toHaveLength(0)
    expect(Object.values(scene().objects).some((o) => o.catalogId === NAPKIN)).toBe(false)
  })

  it('the single-table name is the same call with one id', () => {
    addSeatItemsToTables(COVER, [a, b])
    removeSeatItems(a)
    expect(seatItems(scene(), a)).toHaveLength(0)
    expect(seatItems(scene(), b).length).toBeGreaterThan(0)
  })
})

describe('setObjectsRotation', () => {
  const angleOf = (id: Id) => scene().objects[id].transform.rotation

  it('turns every selected object to the SAME angle, in one undo entry', () => {
    const before = history()
    setObjectsRotation([a, b, c], 45)
    expect(history()).toBe(before + 1)
    for (const id of [a, b, c]) expect(angleOf(id)).toBe(45)

    undo()
    for (const id of [a, b, c]) expect(angleOf(id)).toBe(0)
  })

  it('normalises, so a field cannot walk an object out of range', () => {
    setObjectsRotation([a], 370)
    expect(angleOf(a)).toBe(10)
  })

  it('leaves a locked object where it stands and turns the rest', () => {
    setLocked([b], true)
    setObjectsRotation([a, b, c], 90)
    expect(angleOf(a)).toBe(90)
    expect(angleOf(b)).toBe(0)
    expect(angleOf(c)).toBe(90)
  })
})

describe('setChairModel', () => {
  const chairsOf = (id: Id) =>
    Object.values(scene().objects).filter((o) => o.parentId === id && o.attachment?.kind === 'seat')

  it('re-chairs every selected table and reconciles the seats, in one undo entry', () => {
    const before = history()
    setChairModel([a, b], CHAIR)
    expect(history()).toBe(before + 1)
    for (const id of [a, b]) {
      expect(scene().objects[id].seating?.chairCatalogId).toBe(CHAIR)
      const chairs = chairsOf(id)
      expect(chairs.length).toBeGreaterThan(0)
      expect(chairs.every((o) => o.catalogId === CHAIR)).toBe(true)
    }
    expect(chairsOf(c).every((o) => o.catalogId !== CHAIR)).toBe(true)

    undo()
    expect(chairsOf(a).every((o) => o.catalogId !== CHAIR)).toBe(true)
  })

  /**
   * The single-table `setSeatingConfig` does NOT filter locked tables — it guards
   * on `obj.seating` alone, and `selectors.test.ts` leans on that. This one does,
   * deliberately: a multi-selection routinely holds locked tables, and restyling
   * one silently is the complaint this round answers.
   */
  it('skips a locked table where the single-table action would not', () => {
    setLocked([a], true)
    setChairModel([a, b], CHAIR)
    expect(scene().objects[a].seating?.chairCatalogId).not.toBe(CHAIR)
    expect(scene().objects[b].seating?.chairCatalogId).toBe(CHAIR)
  })

  it('refuses an id the catalogue does not know rather than writing it into the scene', () => {
    setChairModel([a], 'chair.does-not-exist')
    expect(scene().objects[a].seating?.chairCatalogId).not.toBe('chair.does-not-exist')
  })
})

describe('addSeatsBy', () => {
  const seatsOf = (id: Id) => scene().objects[id].seating!.count

  it('adds one seat to every selected table in one undo entry', () => {
    const start = [a, b].map(seatsOf)
    const before = history()
    addSeatsBy([a, b], 1)
    expect(history()).toBe(before + 1)
    expect([a, b].map(seatsOf)).toEqual(start.map((n) => n + 1))

    undo()
    expect([a, b].map(seatsOf)).toEqual(start)
  })

  /**
   * The reason this control is RELATIVE and not a shared "seats = N" field: the
   * ceiling is a fact about each table's own geometry, so the two tables here
   * answer the same +1 differently — and both answers are correct.
   */
  it('clamps against EACH table own maximum, not against a shared one', () => {
    const big = addObject(BIG, { x: 2600, y: 2600 })
    // walk the small table up to its geometric ceiling first
    for (let i = 0; i < 40; i++) addSeatsBy([a], 1)
    const capped = seatsOf(a)
    expect(capped).toBeLessThan(52) // it really stopped, rather than counting to 52
    const roomy = seatsOf(big)
    addSeatsBy([a, big], 1)
    expect(seatsOf(a)).toBe(capped)
    expect(seatsOf(big)).toBe(roomy + 1)
  })

  it('leaves a locked table alone', () => {
    setLocked([a], true)
    const start = seatsOf(a)
    addSeatsBy([a, b], -1)
    expect(seatsOf(a)).toBe(start)
    expect(seatsOf(b)).toBeLessThan(start)
  })
})
