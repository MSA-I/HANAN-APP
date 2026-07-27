import { describe, expect, it } from 'vitest'
import { getVenuePack } from './venuePacks'
import { venueOutline } from './venueOutline'

describe('venueOutline', () => {
  it('returns the resort ring now that the pack carries one', () => {
    // PLAN-06 shipped this reading `pack.outline ?? null`, structurally, before
    // PLAN-07 published the field — so the same code went from drawing the
    // fallback rectangle to drawing the real contour with no edit. Asserting the
    // ring here is what keeps a future re-import from silently emptying it.
    const ring = venueOutline(getVenuePack('resort'))
    expect(ring).not.toBeNull()
    expect(ring!.length).toBeGreaterThanOrEqual(3)
    for (const [x, y] of ring!) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true)
    }
  })

  it('falls back to null with no pack at all', () => {
    // a manual-dimensions project has no pack, and the editor draws the rectangle
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
