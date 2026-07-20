import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import { getTablePreset, presetSeating } from '../presets'
import { getVenuePack } from '../venuePacks'
import { aabbIntersects, pointInPolygon, type AABB } from './bounds'
import {
  DEFAULT_AISLE,
  ceilingAreas,
  fillHallSlots,
  rectRing,
  tableCellSize,
} from './fillHall'

const resort = getVenuePack('resort')!
/** The L-shaped seating area — the packing tests run against real venue data. */
const L = resort.floorAreas![0]

const boxAt = (x: number, y: number, w: number, d: number): AABB => ({
  minX: x - w / 2,
  minY: y - d / 2,
  maxX: x + w / 2,
  maxY: y + d / 2,
})

describe('pointInPolygon', () => {
  it('accepts points inside the L and rejects the notch it cuts out', () => {
    expect(pointInPolygon({ x: 500, y: 500 }, L)).toBe(true) // top-left arm
    expect(pointInPolygon({ x: 300, y: 2000 }, L)).toBe(true) // bottom-left arm
    // the notch: x>770 below y=1410 is NOT part of the seating area
    expect(pointInPolygon({ x: 1500, y: 2000 }, L)).toBe(false)
  })

  it('rejects points outside the bounding box', () => {
    expect(pointInPolygon({ x: -10, y: 500 }, L)).toBe(false)
    expect(pointInPolygon({ x: 4000, y: 500 }, L)).toBe(false)
    expect(pointInPolygon({ x: 500, y: 3000 }, L)).toBe(false)
  })
})

describe('tableCellSize', () => {
  it('is the table plus its chair ring, not the table alone', () => {
    const preset = getTablePreset('preset.round-12-gold-white')!
    const cell = tableCellSize(preset.tableCatalogId, presetSeating(preset))
    const table = getCatalogEntry('table.round').defaultSize.width
    const chair = getCatalogEntry(preset.chairCatalogId).defaultSize.depth
    expect(cell.width).toBeCloseTo(cell.depth, 6) // round table, symmetric ring
    // ring reaches table radius + offset + a full chair depth on each side
    expect(cell.width).toBeGreaterThan(table + 2 * chair * 0.9)
    expect(cell.width).toBeLessThan(table + 2 * chair + 60)
  })

  it('a long rectangular table yields a wide, shallow cell', () => {
    const preset = getTablePreset('preset.knights-22-brown')!
    const cell = tableCellSize(preset.tableCatalogId, presetSeating(preset))
    expect(cell.width).toBeGreaterThan(cell.depth * 2)
  })

  it('a bigger table yields a bigger cell', () => {
    const small = getTablePreset('preset.round-12-gold-white')!
    const large = getTablePreset('preset.round-large-22-gold-black')!
    expect(tableCellSize(large.tableCatalogId, presetSeating(large)).width).toBeGreaterThan(
      tableCellSize(small.tableCatalogId, presetSeating(small)).width,
    )
  })
})

describe('fillHallSlots', () => {
  const preset = getTablePreset('preset.round-12-gold-white')!
  const cell = tableCellSize(preset.tableCatalogId, presetSeating(preset))
  const fill = (over: Partial<Parameters<typeof fillHallSlots>[0]> = {}) =>
    fillHallSlots({
      areas: resort.floorAreas!,
      zones: resort.restricted!,
      cell,
      aisle: DEFAULT_AISLE,
      occupied: [],
      max: 60,
      ...over,
    })

  it('fills the resort with a sane number of tables', () => {
    const slots = fill()
    expect(slots.length).toBeGreaterThan(10)
    expect(slots.length).toBeLessThan(60)
  })

  it('every slot sits fully inside a floor area', () => {
    for (const p of fill()) {
      const b = boxAt(p.x, p.y, cell.width, cell.depth)
      const corners = [
        { x: b.minX, y: b.minY },
        { x: b.maxX, y: b.minY },
        { x: b.minX, y: b.maxY },
        { x: b.maxX, y: b.maxY },
      ]
      const inside = resort.floorAreas!.some((ring) => corners.every((c) => pointInPolygon(c, ring)))
      expect(inside).toBe(true)
    }
  })

  it('no slot lands on a restricted zone (pool, dance floor, corridor…)', () => {
    for (const p of fill()) {
      const b = boxAt(p.x, p.y, cell.width, cell.depth)
      for (const z of resort.restricted!) {
        const zb = { minX: z.x, minY: z.y, maxX: z.x + z.width, maxY: z.y + z.depth }
        // shrink by 1cm: sharing an edge with a zone is legal, overlapping is not
        expect(
          aabbIntersects(
            { minX: b.minX + 1, minY: b.minY + 1, maxX: b.maxX - 1, maxY: b.maxY - 1 },
            zb,
          ),
        ).toBe(false)
      }
    }
  })

  it('no two slots overlap', () => {
    const boxes = fill().map((p) => boxAt(p.x, p.y, cell.width - 1, cell.depth - 1))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(aabbIntersects(boxes[i], boxes[j])).toBe(false)
      }
    }
  })

  it('skips slots blocked by existing furniture and keeps the rest', () => {
    const all = fill()
    const blocked = all[0]
    const after = fill({ occupied: [boxAt(blocked.x, blocked.y, cell.width, cell.depth)] })
    expect(after).toHaveLength(all.length - 1)
    expect(after.some((p) => p.x === blocked.x && p.y === blocked.y)).toBe(false)
    // the survivors did not shift — the grid is absolute, not repacked
    expect(after).toEqual(all.slice(1))
  })

  it('honours max exactly', () => {
    expect(fill({ max: 3 })).toHaveLength(3)
    expect(fill({ max: 0 })).toHaveLength(0)
  })

  it('returns nothing when the cell cannot fit, or there is no area', () => {
    expect(fill({ cell: { width: 99999, depth: 99999 } })).toHaveLength(0)
    expect(fill({ areas: [] })).toHaveLength(0)
  })

  it('is deterministic', () => {
    expect(fill()).toEqual(fill())
  })

  it('centres the run instead of flushing it against one wall', () => {
    const slots = fillHallSlots({
      areas: [rectRing(0, 0, 1000, 1000)],
      zones: [],
      cell: { width: 200, depth: 200 },
      aisle: 100,
      occupied: [],
      max: 60,
    })
    // 3 cells of 200 + 2 aisles of 100 = 800 in a 1000 span ⇒ 100 margin each side
    const xs = [...new Set(slots.map((p) => p.x))].sort((a, b) => a - b)
    expect(xs).toEqual([200, 500, 800])
  })
})

describe('ceilingAreas', () => {
  it('adds the covered zones to the free floor but never the pool or corridor', () => {
    const rings = ceilingAreas(resort, { size: resort.size })
    expect(rings.length).toBe(resort.floorAreas!.length + 3) // dancefloor, bar, chuppah

    // Open water. NB the chuppah and DJ rectangles sit INSIDE the pool rectangle
    // in this pack (a chuppah over the water), so a pool point must be sampled
    // clear of them — the pool centre is under the chuppah.
    expect(rings.some((r) => pointInPolygon({ x: 1000, y: 2000 }, r))).toBe(false)

    const floor = resort.restricted!.find((z) => z.kind === 'dancefloor')!
    const floorCentre = { x: floor.x + floor.width / 2, y: floor.y + floor.depth / 2 }
    expect(rings.some((r) => pointInPolygon(floorCentre, r))).toBe(true)
  })

  it('falls back to the whole room when there is no pack', () => {
    expect(ceilingAreas(undefined, { size: { width: 2400, depth: 1600 } })).toEqual([
      rectRing(0, 0, 2400, 1600),
    ])
  })
})
