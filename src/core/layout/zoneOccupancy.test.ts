import { describe, expect, it } from 'vitest'
import { isPointInZone, isZoneOccupied, type ZoneRect } from './zoneOccupancy'

// the real resort pool and bar, from venuePacks.ts
const POOL: ZoneRect = { x: 766, y: 1408, width: 3196, depth: 1136 }
const BAR: ZoneRect = { x: 1789, y: 0, width: 800, depth: 300 }

describe('isPointInZone', () => {
  it('accepts the centre and rejects a point outside', () => {
    expect(isPointInZone({ x: 2364, y: 1976 }, POOL)).toBe(true)
    expect(isPointInZone({ x: 100, y: 100 }, POOL)).toBe(false)
  })

  it('includes the boundary', () => {
    expect(isPointInZone({ x: 766, y: 1408 }, POOL)).toBe(true)
    expect(isPointInZone({ x: 3962, y: 2544 }, POOL)).toBe(true)
  })
})

describe('isZoneOccupied', () => {
  it('is false for an empty scene', () => {
    expect(isZoneOccupied(BAR, [])).toBe(false)
  })

  it('fires when a bar unit stands in the bar zone', () => {
    expect(isZoneOccupied(BAR, [{ x: 2189, y: 150 }])).toBe(true)
  })

  /**
   * The reason this is a centre test and not an overlap test: furniture is
   * clamped out of restricted zones, so a table parks flush against the pool
   * edge. Its box touches the pool; the pool label must still show.
   */
  it('ignores an object parked flush against the zone edge', () => {
    const tableRadius = 190
    const flushAgainstPoolTop = { x: 2000, y: POOL.y - tableRadius }
    expect(isZoneOccupied(POOL, [flushAgainstPoolTop])).toBe(false)
  })

  it('only needs one of many objects to be on the zone', () => {
    const centres = [
      { x: 100, y: 100 },
      { x: 200, y: 2000 },
      { x: 2364, y: 1976 },
    ]
    expect(isZoneOccupied(POOL, centres)).toBe(true)
  })
})
