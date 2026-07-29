import { describe, expect, it } from 'vitest'
import { getVenuePack } from '../venuePacks'
import { isPointInZone, isZoneInside, isZoneOccupied, zoneUnder, type ZoneRect } from './zoneOccupancy'

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

/**
 * Read off the live pack, never off literals: this is the rule that decides which
 * side of the hall/reception toggle a zone belongs to, and a frozen rectangle here
 * would keep passing while the toggle went wrong on screen (AGENT-BRIEF §1.7).
 */
describe('isZoneInside', () => {
  const zones = getVenuePack('resort')!.restricted!
  const deck = zones.find((z) => z.kind === 'kabalatPanim')!

  it('separates the two chuppah zones by where they are, not by their kind', () => {
    const chuppahs = zones.filter((z) => z.kind === 'chuppah')
    expect(chuppahs).toHaveLength(2)
    // one stands on the reception deck (+5.20), one in the hall by the pool (+0.50)
    expect(chuppahs.filter((z) => isZoneInside(z, deck))).toHaveLength(1)
    expect(chuppahs.find((z) => isZoneInside(z, deck))!.elevation).toBe(520)
  })

  it('claims nothing else in the hall for the deck', () => {
    const onDeck = zones.filter((z) => z.kind !== 'kabalatPanim' && isZoneInside(z, deck))
    expect(onDeck.map((z) => z.kind)).toEqual(['chuppah'])
  })
})

/**
 * The level a piece stands at. `zoneKind` names a family, and the resort's chuppah
 * family has two members at different heights — reading the first one drew a
 * chuppah placed on the deck 4.70 m below it, inside the walls.
 */
describe('zoneUnder', () => {
  const chuppahs = getVenuePack('resort')!.restricted!.filter((z) => z.kind === 'chuppah')
  const centre = (z: ZoneRect) => ({ x: z.x + z.width / 2, y: z.y + z.depth / 2 })

  it('answers with the pad the point is standing on, not the first declared', () => {
    for (const pad of chuppahs) expect(zoneUnder(chuppahs, centre(pad))).toBe(pad)
    // and the two really are at different levels, or this test proves nothing
    expect(new Set(chuppahs.map((z) => z.elevation)).size).toBe(2)
  })

  it('falls back to the nearest when the point is on neither', () => {
    const hall = chuppahs.find((z) => z.elevation === 50)!
    const justOutside = { x: hall.x - 40, y: centre(hall).y }
    expect(zoneUnder(chuppahs, justOutside)).toBe(hall)
  })

  it('has nothing to say about an empty family', () => {
    expect(zoneUnder([], { x: 0, y: 0 })).toBeUndefined()
  })
})
