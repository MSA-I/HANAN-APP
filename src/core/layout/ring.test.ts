/**
 * The ⌀380 round table's central hole.
 *
 * A ring is a `circle` outline carrying `rInner` (see catalog/types.ts for why it
 * is not a third `Outline` variant). These tests pin the three regions apart —
 * hole, ring, outside — and the rule that the hole hit-tests as PART OF the
 * table, since dropping decor into it is the whole reason it is modelled.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { Outline } from '../catalog/types'
import type { Transform2D } from '../model/types'
import { holeRadius, outlineAABB, pointInHole, pointInOutline } from './bounds'
import { computeMaxSeats, computeSeatTransforms } from './seatLayout'

/** Measured off public/props/table-round-380.glb — see entries/tables.ts. */
const R_OUTER = 190
const R_INNER = 78

const ring: Outline = { kind: 'circle', r: R_OUTER, rInner: R_INNER }
const disc: Outline = { kind: 'circle', r: R_OUTER }
const rect: Outline = { kind: 'rect', w: 100, h: 60 }

const at = (x: number, y: number, rotation = 0): Transform2D => ({
  position: { x, y },
  rotation,
  elevation: 0,
})
const ORIGIN = at(0, 0)

describe('the ⌀380 catalog entry', () => {
  it('declares the hole measured off its GLB, in both outline and parts', () => {
    const entry = getCatalogEntry('table.round-large')
    const fp = entry.footprint(entry.defaultSize)
    expect(fp.outline).toEqual({ kind: 'circle', r: R_OUTER, rInner: R_INNER })
    expect(fp.parts).toHaveLength(1)
    expect(fp.parts[0]).toMatchObject({ kind: 'circle', r: R_OUTER, rInner: R_INNER })
  })

  it('is the only table with a hole — the ⌀180 was measured solid', () => {
    for (const id of ['table.round', 'table.square', 'table.banquet', 'table.knights-480']) {
      const entry = getCatalogEntry(id)
      expect(holeRadius(entry.footprint(entry.defaultSize).outline)).toBe(0)
    }
  })
})

describe('holeRadius', () => {
  it('reports the hole, and zero for anything solid', () => {
    expect(holeRadius(ring)).toBe(R_INNER)
    expect(holeRadius(disc)).toBe(0)
    expect(holeRadius(rect)).toBe(0)
    expect(holeRadius({ kind: 'circle', r: 90, rInner: 0 })).toBe(0)
  })
})

describe('outlineAABB', () => {
  it('boxes a ring exactly like the disc of the same outer radius', () => {
    // the hole is interior — it cannot shrink the extent, and a box that tried to
    // describe it would break every snapping and venue-clamp caller
    expect(outlineAABB(ORIGIN, ring)).toEqual(outlineAABB(ORIGIN, disc))
    expect(outlineAABB(ORIGIN, ring)).toEqual({
      minX: -R_OUTER,
      minY: -R_OUTER,
      maxX: R_OUTER,
      maxY: R_OUTER,
    })
  })

  it('is rotation-independent, as a circle must be', () => {
    expect(outlineAABB(at(0, 0, 37), ring)).toEqual(outlineAABB(ORIGIN, ring))
  })

  it('follows the table when it is placed away from the origin', () => {
    expect(outlineAABB(at(500, -200), ring)).toEqual({
      minX: 500 - R_OUTER,
      minY: -200 - R_OUTER,
      maxX: 500 + R_OUTER,
      maxY: -200 + R_OUTER,
    })
  })
})

describe('pointInOutline over the three regions', () => {
  const world = at(500, -200, 25)
  const radial = (r: number) => at(world.position.x + r, world.position.y)

  it('counts the hole as inside the table', () => {
    // the hole is a place you PUT things; a miss here would make the ⌀380
    // undroppable in its centre and let the click fall through to the floor
    expect(pointInOutline(world.position, world, ring)).toBe(true)
    expect(pointInOutline(radial(R_INNER - 1).position, world, ring)).toBe(true)
  })

  it('counts the ring itself as inside', () => {
    expect(pointInOutline(radial(R_INNER + 1).position, world, ring)).toBe(true)
    expect(pointInOutline(radial(R_OUTER - 1).position, world, ring)).toBe(true)
    expect(pointInOutline(radial(R_OUTER).position, world, ring)).toBe(true)
  })

  it('counts outside the outer radius as outside', () => {
    expect(pointInOutline(radial(R_OUTER + 1).position, world, ring)).toBe(false)
  })
})

describe('pointInHole', () => {
  const world = at(500, -200, 25)
  const radial = (r: number) => ({ x: world.position.x + r, y: world.position.y })

  it('is true strictly inside the hole and false on the ring', () => {
    expect(pointInHole(world.position, world, ring)).toBe(true)
    expect(pointInHole(radial(R_INNER - 0.01), world, ring)).toBe(true)
    expect(pointInHole(radial(R_INNER), world, ring)).toBe(false)
    expect(pointInHole(radial(R_INNER + 1), world, ring)).toBe(false)
    expect(pointInHole(radial(R_OUTER + 50), world, ring)).toBe(false)
  })

  it('is false everywhere on a solid outline, so callers need not branch', () => {
    expect(pointInHole(world.position, world, disc)).toBe(false)
    expect(pointInHole(world.position, world, rect)).toBe(false)
  })

  it('does not care about the table rotation — a ring is symmetric', () => {
    for (const rot of [0, 25, 90, 180, -47]) {
      expect(pointInHole(radial(R_INNER / 2), at(500, -200, rot), ring)).toBe(true)
    }
  })
})

describe('seating a ring', () => {
  const chair = { width: 45, depth: 45, height: 90 }
  const seating = (count: number) => ({
    enabled: true,
    chairCatalogId: 'chair.x-white',
    count,
    gap: 10,
    offset: 6,
    startAngle: 0,
  })

  it('seats round the OUTER edge, exactly as the solid disc would', () => {
    // chairs go where people sit; the hole is 78cm away on the far side of the
    // table top and has no bearing on capacity or placement
    expect(computeMaxSeats(ring, seating(99), chair)).toBe(computeMaxSeats(disc, seating(99), chair))
    expect(computeSeatTransforms(ring, seating(22), chair)).toEqual(
      computeSeatTransforms(disc, seating(22), chair),
    )
    for (const s of computeSeatTransforms(ring, seating(22), chair)) {
      expect(Math.hypot(s.position.x, s.position.y)).toBeCloseTo(R_OUTER + 6 + chair.depth / 2)
    }
  })

  it('still seats the 22 the catalog entry promises', () => {
    const entry = getCatalogEntry('table.round-large')
    const cap = entry.seating!
    const house = getCatalogEntry(cap.defaultChair).defaultSize
    const fits = computeMaxSeats(
      entry.footprint(entry.defaultSize).outline,
      { ...seating(99), gap: cap.defaultGap, offset: cap.defaultOffset },
      house,
    )
    expect(fits).toBeGreaterThanOrEqual(cap.defaultCount)
  })
})
