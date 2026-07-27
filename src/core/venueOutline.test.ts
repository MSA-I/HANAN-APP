import { describe, expect, it } from 'vitest'
import { getVenuePack } from './venuePacks'
import { venueOutline } from './venueOutline'

describe('venueOutline', () => {
  it('falls back to null for the packs that ship today', () => {
    // PLAN-07 adds `outline`; until then the editor must draw the rectangle
    expect(venueOutline(getVenuePack('resort'))).toBeNull()
    expect(venueOutline(getVenuePack(null))).toBeNull()
    expect(venueOutline(undefined)).toBeNull()
  })

  it('accepts a ring once the pack carries one', () => {
    const ring: [number, number][] = [
      [0, 0],
      [4423, 0],
      [4423, 2544],
      [0, 2544],
    ]
    expect(venueOutline({ outline: ring })).toBe(ring)
  })

  it('rejects rings that cannot be drawn', () => {
    expect(venueOutline({ outline: [] })).toBeNull()
    expect(
      venueOutline({
        outline: [
          [0, 0],
          [1, 1],
        ],
      }),
    ).toBeNull()
    expect(venueOutline({ outline: [[0, 0], [1, 1], [Number.NaN, 2]] })).toBeNull()
    expect(venueOutline({ outline: 'nope' })).toBeNull()
  })
})
