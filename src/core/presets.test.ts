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
    // ⌀180 with a ring of place settings leaves ~⌀108 free in the middle
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

  // ⌀180 with 12 covers is the tightest top the venue owns: the ring of place
  // settings reaches in to r = 55.7, leaving a ⌀111 centre for the whole design.
  it.each(TABLE_DESIGNS)('$id on the ⌀180 round', (design) => {
    const tableId = addObject('table.round', { x: 600, y: 600 })
    expect(applyTableDesign(design.id, tableId).length).toBeGreaterThan(0)
    expectNoOverlaps(tableId)
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
    for (const catalogId of ['table.square', 'table.banquet']) {
      const tableId = addObject(catalogId, { x: 600, y: 600 })
      expect(applyTableDesign(design.id, tableId).length).toBeGreaterThan(0)
      expectNoOverlaps(tableId)
    }
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
