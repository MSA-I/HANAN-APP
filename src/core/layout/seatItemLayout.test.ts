import { describe, expect, it } from 'vitest'
import type { Outline } from '../catalog/types'
import type { SeatingConfig, Size3D, Transform2D } from '../model/types'
import { rotateVec } from '../space'
import { seatItemTransforms } from './seatItemLayout'
import { computeSeatTransforms } from './seatLayout'

const chair: Size3D = { width: 45, depth: 45, height: 92 }
const item: Size3D = { width: 45, depth: 33, height: 15.9 } // decor.place-setting
const seating = (count: number, gap: number): SeatingConfig => ({
  enabled: true,
  chairCatalogId: 'chair.x-white',
  count,
  gap,
  offset: 6,
  startAngle: 0,
})

/** offset 6 + chair 45/2 + inset 3 + item 33/2 */
const DISTANCE = 48

const lay = (outline: Outline, cfg: SeatingConfig) => {
  const seats = computeSeatTransforms(outline, cfg, chair)
  return { seats, items: seatItemTransforms(seats, chair, item, cfg.offset) }
}

/** The four corners of a placed item, in the table's frame. */
function corners(t: Transform2D): { x: number; y: number }[] {
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([sx, sy]) => {
    const c = rotateVec({ x: (sx * item.width) / 2, y: (sy * item.depth) / 2 }, t.rotation)
    return { x: t.position.x + c.x, y: t.position.y + c.y }
  })
}

// the venue's two extremes: the round table it seats 12 around, and the rectangle
const CASES = [
  { name: 'round ⌀180 · 12 seats', outline: { kind: 'circle', r: 90 } as const, cfg: seating(12, 10) },
  { name: 'banquet 240×120 · 12 seats', outline: { kind: 'rect', w: 240, h: 120 } as const, cfg: seating(12, 8) },
]

for (const { name, outline, cfg } of CASES) {
  describe(`place settings — ${name}`, () => {
    it('lays exactly one item per seat', () => {
      const { seats, items } = lay(outline, cfg)
      expect(seats).toHaveLength(cfg.count)
      expect(items).toHaveLength(seats.length)
    })

    it('turns each item to face its guest', () => {
      const { seats, items } = lay(outline, cfg)
      items.forEach((t, i) => expect(t.rotation).toBe(seats[i].rotation + 180))
    })

    it('sets every item the same distance in front of its seat', () => {
      const { seats, items } = lay(outline, cfg)
      items.forEach((t, i) => {
        const dx = t.position.x - seats[i].position.x
        const dy = t.position.y - seats[i].position.y
        expect(Math.hypot(dx, dy)).toBeCloseTo(DISTANCE)
      })
    })

    it('points every item outward, away from the table centre', () => {
      for (const t of lay(outline, cfg).items) {
        const front = rotateVec({ x: 0, y: -1 }, t.rotation)
        expect(front.x * t.position.x + front.y * t.position.y).toBeGreaterThan(0)
      }
    })

    it('keeps every item on the table top', () => {
      for (const t of lay(outline, cfg).items) {
        for (const c of corners(t)) {
          if (outline.kind === 'circle') {
            expect(Math.hypot(c.x, c.y)).toBeLessThanOrEqual(outline.r)
          } else {
            expect(Math.abs(c.x)).toBeLessThanOrEqual(outline.w / 2)
            expect(Math.abs(c.y)).toBeLessThanOrEqual(outline.h / 2)
          }
        }
      }
    })
  })
}

describe('place settings — edge cases', () => {
  it('leaves an unseated table empty', () => {
    expect(seatItemTransforms([], chair, item, 6)).toEqual([])
  })

  // Honest note, not a defect: 12 covers on a ⌀180 round is genuinely tight. The
  // settings sit on a ⌀141 circle, so the pitch is 36.9cm against a 45cm-wide
  // setting — they overlap ~8cm. Every other table in the venue is clear.
  it('admits the ⌀180 × 12 overlap rather than hiding it', () => {
    const { items } = lay({ kind: 'circle', r: 90 }, seating(12, 10))
    const r = Math.hypot(items[0].position.x, items[0].position.y)
    expect(r).toBeCloseTo(70.5)
    const pitch = (2 * Math.PI * r) / items.length
    expect(pitch).toBeCloseTo(36.9, 1)
    expect(pitch).toBeLessThan(item.width)
  })
})
