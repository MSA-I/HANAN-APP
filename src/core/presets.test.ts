/**
 * Integrity of the preset registries against the catalog and the Hebrew string
 * dictionary. This is the guard for the real-inventory principle: a preset that
 * names an asset the venue does not own must fail here, not in the browser.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry, hasCatalogEntry } from './catalog/registry'
import { HALL_LAYOUTS, layoutStats } from './hallLayouts'
import { clampHang, hangRange } from './layout/beams'
import { checkPlacement } from './layout/collision'
import { maxSeatsForEntry } from './layout/seatLayout'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS, getTablePreset, presetSeating } from './presets'
import { getVenuePack } from './venuePacks'
import {
  addObject,
  applyHallDesign,
  applyTableDesign,
  beginGesture,
  endGesture,
  newProject,
  setElevation,
  undo,
} from '../state/actions'
import { useEditorStore } from '../state/store'
import { strings } from '../ui/strings'

const items = strings.presets.items
const known = (labelKey: string) => Object.prototype.hasOwnProperty.call(items, labelKey)

/**
 * A design authored outside PLAN-02 cannot seed its own dictionary key, so it
 * carries the Hebrew inline until that key lands (TableDesign.pendingLabel).
 * Either source counts as "this entry has a label"; neither being present is
 * still a failure, which is the point of the check.
 */
const hasLabel = (entry: { labelKey: string; pendingLabel?: string }) =>
  known(entry.labelKey) || entry.pendingLabel !== undefined

describe('table presets', () => {
  it.each(TABLE_PRESETS)('$id composes real catalog entries', (preset) => {
    expect(hasCatalogEntry(preset.tableCatalogId)).toBe(true)
    expect(hasCatalogEntry(preset.chairCatalogId)).toBe(true)
    const table = getCatalogEntry(preset.tableCatalogId)
    expect(table.category).toBe('tables')
    expect(table.seating).toBeDefined()
    expect(getCatalogEntry(preset.chairCatalogId).category).toBe('seating')
  })

  it.each(TABLE_PRESETS)('$id asks for a seat count the table can take', (preset) => {
    const table = getCatalogEntry(preset.tableCatalogId)
    const seating = presetSeating(preset)
    const fits = maxSeatsForEntry(table, table.defaultSize, seating, getCatalogEntry(preset.chairCatalogId).defaultSize)
    expect(preset.seatCount).toBeGreaterThanOrEqual(table.seating!.min)
    expect(preset.seatCount).toBeLessThanOrEqual(table.seating!.max)
    // a preset that over-asks would silently lose chairs to the reconciler's clamp
    expect(preset.seatCount).toBeLessThanOrEqual(fits)
  })
})

describe('table designs', () => {
  it.each(TABLE_DESIGNS)('$id places only surface decor', (design) => {
    expect(design.items.length).toBeGreaterThan(0)
    for (const item of design.items) {
      expect(hasCatalogEntry(item.catalogId)).toBe(true)
      expect(getCatalogEntry(item.catalogId).placement).toBe('surface')
    }
  })

  it.each(TABLE_DESIGNS)('$id uses a real place setting, if any', (design) => {
    if (!design.seatItem) return
    expect(hasCatalogEntry(design.seatItem)).toBe(true)
    expect(getCatalogEntry(design.seatItem).placement).toBe('seat')
  })

  it.each(TABLE_DESIGNS)('$id keeps its offsets on the smallest table', (design) => {
    // ⚠ THIS BOUND IS NOW TOO LOOSE, deliberately left alone. It was set against a
    // ⌀111 free centre computed from the ⌀180's DECLARED rim; the real top is
    // 12 cm inside that (layout/seatItemLayout.ts `tableTopInset`), so the free
    // centre is ⌀87.4 and an |x| of 40 no longer clears the covers. Tightening it
    // here would only hide which designs are affected — they are named, and
    // asserted, in 'table designs lay clear of themselves' below.
    for (const item of design.items) {
      expect(Math.abs(item.x ?? 0)).toBeLessThanOrEqual(40)
      expect(Math.abs(item.y ?? 0)).toBeLessThanOrEqual(15)
    }
  })
})

describe('hall designs', () => {
  it.each(HALL_DESIGNS)('$id hangs a real ceiling fixture', (design) => {
    expect(hasCatalogEntry(design.catalogId)).toBe(true)
    expect(getCatalogEntry(design.catalogId).placement).toBe('ceiling')
    expect(design.spacing).toBeGreaterThan(0)
  })

  /**
   * Source doc §43. The band is the FIXTURE's own — it shifts with the entry's
   * height — so a single house figure would be legal for one design and silently
   * clamped for the next. Read from the pack, never spelled out here (BRIEF §1.7).
   */
  it.each(HALL_DESIGNS)('$id hangs at a height the resort really allows', (design) => {
    const pack = getVenuePack('resort')!
    const height = getCatalogEntry(design.catalogId).defaultSize.height
    const range = hangRange(pack, pack.wallHeight, height)
    expect(design.floorDistance).toBeDefined()
    const cm = design.floorDistance!

    expect(cm).toBeGreaterThanOrEqual(range.min)
    expect(cm).toBeLessThanOrEqual(range.max)
    // the assertion that matters: a value the clamp would MOVE is a value the
    // design does not really state, and the user would never see it applied
    expect(clampHang(pack, pack.wallHeight, height, cm)).toBe(cm)
  })
})

/**
 * Source doc §21 asks for the hang height as part of the lighting design, but
 * `applyHallDesign` does not set elevations — `PresetsSection` composes it from
 * two public actions instead (the file it would have to change belongs to another
 * plan this wave). The composition is the behaviour, so it is what is tested:
 * component tests do not exist here (BRIEF §1.7), the action sequence does.
 */
describe('a hall design applied at its floorDistance', () => {
  beforeEach(() => {
    newProject({ name: 'lighting', venuePackId: 'resort' })
  })

  it.each(HALL_DESIGNS)('$id trims every fixture, and Ctrl+Z takes back all of it', (design) => {
    const before = useEditorStore.getState().scene.objectOrder.length
    // exactly the sequence PresetsSection runs on a card click
    beginGesture()
    const ids = applyHallDesign(design.id)
    for (const id of ids) setElevation(id, design.floorDistance!)
    endGesture()

    expect(ids.length).toBeGreaterThan(0)
    const scene = useEditorStore.getState().scene
    // no clamp moved them: setElevation stores what the design asked for
    for (const id of ids) expect(scene.objects[id].transform.elevation).toBe(design.floorDistance)

    // ONE undo for the lay AND every height — the whole gesture is one entry
    undo()
    const after = useEditorStore.getState().scene
    expect(after.objectOrder).toHaveLength(before)
    for (const id of ids) expect(after.objects[id]).toBeUndefined()
  })
})

/**
 * A design the app lays and then paints red is a visible bug, and nothing at
 * runtime can catch it: `layTableDesign` writes to the scene without ever asking
 * `checkPlacement` (handoff/06-collision-api.md §7.4), by design — a design that
 * lays two pieces near each other must not be refused on its own. That makes this
 * the ONLY guard, so it runs the real action against a real table rather than
 * re-deriving geometry the app would not use.
 */
describe('table designs lay clear of themselves', () => {
  beforeEach(() => {
    newProject({ name: 'design-collision', venueWidth: 2400, venueDepth: 1600 })
  })

  /** Everything the design put on the top: its decor AND its place settings.
   *  Chairs carry `attachment.kind === 'seat'` and are not on the top at all. */
  const laidOnTop = (tableId: string) =>
    Object.values(useEditorStore.getState().scene.objects).filter(
      (o) => o.parentId === tableId && o.attachment?.kind === 'surface',
    )

  const expectNoOverlaps = (tableId: string) => {
    const scene = useEditorStore.getState().scene
    const children = laidOnTop(tableId)
    expect(children.length).toBeGreaterThan(0)
    for (const child of children) {
      // parentLocal: an existing child's transform already lives in the parent's
      // frame; handing it over as world would report overlaps metres away
      const violations = checkPlacement(scene, {
        catalogId: child.catalogId,
        transform: child.transform,
        size: child.size,
        excludeId: child.id,
        parentId: tableId,
        parentLocal: true,
        inHole: child.attachment?.kind === 'surface' ? child.attachment.inHole : undefined,
      })
      expect(
        violations
          .filter((v) => v.kind === 'overlapsSibling')
          .map((v) => `${child.catalogId} overlaps ${scene.objects[v.id]?.catalogId}`),
      ).toEqual([])
    }
  }

  const selfCollides = (tableId: string) => {
    const scene = useEditorStore.getState().scene
    return laidOnTop(tableId).some((child) =>
      checkPlacement(scene, {
        catalogId: child.catalogId,
        transform: child.transform,
        size: child.size,
        excludeId: child.id,
        parentId: tableId,
        parentLocal: true,
        inHole: child.attachment?.kind === 'surface' ? child.attachment.inHole : undefined,
      }).some((v) => v.kind === 'overlapsSibling'),
    )
  }

  /**
   * ⛔ RECORDED, NOT FIXED — the designs' offsets and the covers' new anchor
   * disagree, and neither belongs to whoever last touched them.
   *
   * The designs below were authored against a free centre that no longer exists.
   * The budget is written out in presets.ts: "on the ⌀180 round the ring of 12
   * place settings puts their inner edge at r = 90 − 3 − 31.3/2 = 55.7, i.e. a
   * ⌀111 free centre". That 3 was the whole inset from the DECLARED rim — and the
   * declared rim is the GLB's bounding box, which is the hem of the tablecloth at
   * the floor, not the surface. `layout/seatItemLayout.ts`'s `tableTopInset` now
   * adds the measured 12 cm between the two, so the covers sit on the top the way
   * the source doc asked (§3, §23) and the free centre is ⌀87.4, not ⌀111.
   *
   * The same subtraction on the banquet leaves a 25 cm strip down the middle of a
   * table whose centrepieces are ~31 cm deep. Measured penetrations are 3-8 cm.
   *
   * ⚠ THIS IS NOT A LAYOUT BUG AND IT IS NOT FIXABLE IN THE LAYOUT. Either the
   * designs' offsets shrink (presets.ts) or the pieces do (entries/tableDecor.ts) —
   * both are authored content, and both are someone's decision rather than a
   * derivation. Written up in handoff/05-anchoring.md. Asserted INVERTED here, in
   * the same idiom as the ⌀380 block below: when the offsets are re-authored this
   * fails, and failing is the message. Move the id back to the pass-case then.
   */
  const CLASHES_WITH_ITS_COVERS: Record<string, string[]> = {
    'table.round': ['design.classic-gold', 'design.floral-pink', 'design.ceramic-low'],
    'table.square': [],
    'table.banquet': [
      'design.classic-gold',
      'design.crystal',
      'design.floral-pink',
      'design.crystal-tall',
      'design.hurricane-glass',
    ],
  }

  const expectDesign = (design: { id: string }, catalogId: string) => {
    const tableId = addObject(catalogId, { x: 600, y: 600 })
    expect(applyTableDesign(design.id, tableId).length).toBeGreaterThan(0)
    if (CLASHES_WITH_ITS_COVERS[catalogId].includes(design.id)) expect(selfCollides(tableId)).toBe(true)
    else expectNoOverlaps(tableId)
  }

  // ⌀180 with 12 covers is the tightest top the venue owns: the ring of place
  // settings reaches in to r = 43.7 on the REAL top, leaving a ⌀87 centre.
  it.each(TABLE_DESIGNS)('$id on the ⌀180 round', (design) => {
    expectDesign(design, 'table.round')
  })

  /**
   * ⛔ THE ⌀380 IS BROKEN TODAY, AND THIS PINS IT SO A FIX IS NOTICED.
   *
   * The block below explains why it is excluded from the pass-case. Excluding it
   * was right — it does not pass — but an exclusion is invisible: nothing then
   * tells anyone whether the bug is still there, got worse, or was fixed. Round 2
   * ended with this handed from PLAN-08 to PLAN-07 and PLAN-07 closing without it,
   * so it now has no owner and would have had no safety net either.
   *
   * This asserts the CURRENT WRONG BEHAVIOUR on purpose. When `clampToSurface`
   * learns what to do with a centre-anchored piece over a hole, this test fails —
   * and failing is the message. Delete it then and move the table up into the
   * pass-case above.
   */
  it('⌀380: every design still self-collides — recorded, not fixed', () => {
    const offenders: string[] = []
    for (const design of TABLE_DESIGNS) {
      newProject({ name: 'ring-overlap', venuePackId: 'resort' })
      const tableId = addObject('table.round-large', { x: 600, y: 600 })
      expect(applyTableDesign(design.id, tableId).length).toBeGreaterThan(0)
      const scene = useEditorStore.getState().scene
      const hit = laidOnTop(tableId).some((child) =>
        checkPlacement(scene, {
          catalogId: child.catalogId,
          transform: child.transform,
          size: child.size,
          excludeId: child.id,
          parentId: tableId,
          parentLocal: true,
          inHole: child.attachment?.kind === 'surface' ? child.attachment.inHole : undefined,
        }).some((v) => v.kind === 'overlapsSibling'),
      )
      if (hit) offenders.push(design.id)
    }
    // ALL of them, not some — the cause is the clamp, so it cannot be design-specific
    expect(offenders).toEqual(TABLE_DESIGNS.map((d) => d.id))
  })

  // ⚠ `table.round-large` is deliberately NOT here. Every design — the four that
  // shipped before this wave included — self-collides on it, and the cause is in
  // `clampToSurface`, not in any design: the ⌀156 opening pushes a non-`inHole`
  // child out to `hole + reach`, and a piece at the exact centre has no radial
  // direction, so it takes the arbitrary +x and lands on the design's own +x
  // flank. Measured for design.classic-gold: centrepiece 0 → 96.4, flank 38 →
  // 84.25, i.e. 12.5 cm of overlap. actions.ts belongs to PLAN-07 this wave —
  // written up in handoff/FOUND-08.md rather than fixed here.

  // the two rectangular tops clamp per-axis rather than radially, so they are a
  // different code path through clampToSurface and not implied by the round one
  it.each(TABLE_DESIGNS)('$id on the square and the banquet', (design) => {
    for (const catalogId of ['table.square', 'table.banquet']) expectDesign(design, catalogId)
  })
})

describe('hall layouts', () => {
  it.each(HALL_LAYOUTS)('$id references a real venue pack and real presets', (layout) => {
    expect(getVenuePack(layout.venuePackId)).toBeDefined()
    expect(layout.placements.length).toBeGreaterThan(0)
    for (const p of layout.placements) expect(getTablePreset(p.presetId)).toBeDefined()
  })

  it.each(HALL_LAYOUTS)('$id keeps every table inside the venue bounds', (layout) => {
    const pack = getVenuePack(layout.venuePackId)!
    for (const p of layout.placements) {
      const entry = getCatalogEntry(getTablePreset(p.presetId)!.tableCatalogId)
      const half = Math.max(entry.defaultSize.width, entry.defaultSize.depth) / 2
      expect(p.x - half).toBeGreaterThanOrEqual(0)
      expect(p.y - half).toBeGreaterThanOrEqual(-half) // rotated rects only need the loose bound
      expect(p.x + half).toBeLessThanOrEqual(pack.size.width)
      expect(p.y + half).toBeLessThanOrEqual(pack.size.depth)
    }
  })

  it.each(HALL_LAYOUTS)('$id stats add up', (layout) => {
    const stats = layoutStats(layout)
    expect(stats.tables).toBe(layout.placements.length)
    expect(stats.seats).toBeGreaterThan(0)
  })
})

describe('registry hygiene', () => {
  const all = [...TABLE_PRESETS, ...TABLE_DESIGNS, ...HALL_DESIGNS, ...HALL_LAYOUTS]

  it('every entry has a Hebrew label', () => {
    const missing = all.filter((e) => !hasLabel(e)).map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('ids are unique across all three registries', () => {
    const ids = all.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no orphan strings', () => {
    const used = new Set(all.map((e) => e.labelKey))
    expect(Object.keys(items).filter((k) => !used.has(k))).toEqual([])
  })
})
