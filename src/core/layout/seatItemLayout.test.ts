import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { Outline } from '../catalog/types'
import type { SeatingConfig, Size3D, Transform2D } from '../model/types'
import { rotateVec } from '../space'
import { holeRadius } from './bounds'
import { seatItemTransforms } from './seatItemLayout'
import { computeSeatTransforms, seatsForEntry } from './seatLayout'
import { serpentineBandDepth } from './serpentine'

const CHAIR = 'chair.x-white'
const SETTING = 'decor.place-setting'
const chair: Size3D = getCatalogEntry(CHAIR).defaultSize
const item: Size3D = getCatalogEntry(SETTING).defaultSize
const seating = (count: number, gap: number): SeatingConfig => ({
  enabled: true,
  chairCatalogId: CHAIR,
  count,
  gap,
  offset: 6,
  startAngle: 0,
})

/** seat offset + half the chair + seatItemTransforms' 3cm edge inset + half the item */
const DISTANCE = 6 + chair.depth / 2 + 3 + item.depth / 2

const lay = (outline: Outline, cfg: SeatingConfig) => {
  const seats = computeSeatTransforms(outline, cfg, chair)
  // the outline goes in as the top, exactly as laySeatItems passes it
  return { seats, items: seatItemTransforms(seats, chair, item, cfg.offset, outline) }
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
})

/**
 * Separating axis theorem on two oriented rectangles: positive = they interpenetrate
 * by that many cm, negative = they clear each other by that many. Centre pitch alone
 * is not enough on a round table — neighbouring covers splay by 360/n degrees, so
 * their far corners meet well before their edges do.
 */
function overlap(a: Transform2D, b: Transform2D): number {
  const polys = [a, b].map(corners)
  let best = Infinity
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const len = Math.hypot(q.x - p.x, q.y - p.y)
      const nx = -(q.y - p.y) / len
      const ny = (q.x - p.x) / len
      const span = (poly2: { x: number; y: number }[]) => {
        const vs = poly2.map((v) => v.x * nx + v.y * ny)
        return [Math.min(...vs), Math.max(...vs)]
      }
      const [a0, a1] = span(polys[0])
      const [b0, b1] = span(polys[1])
      best = Math.min(best, Math.min(a1, b1) - Math.max(a0, b0))
    }
  }
  return best
}

/** smallest angle between two headings, degrees */
const between = (p: number, q: number) => Math.abs((((p - q) % 360) + 540) % 360 - 180)

/**
 * The worst overlap between two covers laid SIDE BY SIDE along the same run of the
 * table — the thing the cover's width has to answer for, and what source doc §2a
 * ("they are too big and ride on top of each other") is about.
 *
 * Covers that meet near-perpendicular are excluded on purpose: those are the two
 * rows converging at a corner of a rectangular table, and at the head of the S.
 * That overlap is a property of how seatLayout allocates seats around a corner —
 * it survives every credible cover size (it needs scale 0.5 to clear on the
 * banquet) so it is not a size question. Written up in handoff/FOUND-03.md.
 */
function worstInlineOverlap(items: Transform2D[]): number {
  let worst = -Infinity
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (between(items[i].rotation, items[j].rotation) > 45) continue
      worst = Math.max(worst, overlap(items[i], items[j]))
    }
  }
  return worst
}

const topOf = (tableId: string): Outline => {
  const entry = getCatalogEntry(tableId)
  return entry.footprint(entry.defaultSize).outline
}

function coversOn(tableId: string): Transform2D[] {
  const entry = getCatalogEntry(tableId)
  const s = entry.seating!
  const cfg = seating(s.defaultCount, s.defaultGap)
  const seats = seatsForEntry(entry, entry.defaultSize, { ...cfg, offset: s.defaultOffset }, chair)
  return seatItemTransforms(seats, chair, item, s.defaultOffset, topOf(tableId))
}

/**
 * Source doc §2a and §42: the cover was resized because a full set of them rode on
 * top of each other. This is that claim, checked on every table the venue owns
 * rather than on the round one the plan worked out by hand.
 */
describe('place settings — a full set on every table in the venue', () => {
  // The five that a 0.8 cover clears outright. Measured margins at the sizes in
  // the catalog today: ⌀380 8.6cm, square 17.3, banquet 24.0, knights 17.3,
  // serpentine 5.0.
  for (const tableId of [
    'table.round-large',
    'table.square',
    'table.banquet',
    'table.knights-480',
    'table.serpentine',
  ]) {
    it(`lays a full set on ${tableId} with no two covers touching`, () => {
      expect(worstInlineOverlap(coversOn(tableId))).toBeLessThan(0)
    })
  }

  // Honest note, not a defect, and the one table the resize could not rescue: a
  // full 12 on the ⌀180 is genuinely over-set. The covers land on a ⌀142.7 circle,
  // which is 37.3cm of arc each against a 36cm cover — the edges clear, but
  // neighbours splay 30° apart and their far corners do not. Clearing it needs a
  // cover about 31cm wide, whose charger would be 21cm and no longer a dinner
  // plate. Shrinking the setting to 0.8 took this from 18.0cm to 5.7cm.
  /**
   * Source doc §43: "there are complicated tables like the circle or the snake
   * where the settings sit either at the EDGE of the table or get distorted."
   *
   * The two shapes the plan named, checked against the geometry rather than
   * against the worry. Both come out clean, and by a wide margin — the numbers
   * are pinned below so that a future change to the cover, the chair or the
   * fitted arcs cannot quietly eat the margin.
   */
  describe('the two shapes the seat frame cannot see', () => {
    const RING = 'table.round-large'

    it('keeps every cover on the ⌀380 ring, clear of the opening', () => {
      const top = topOf(RING)
      const rInner = holeRadius(top)
      const rOuter = top.kind === 'circle' ? top.r : 0
      expect(rInner).toBeGreaterThan(0) // it really is a ring, not a disc

      const radii = coversOn(RING).flatMap((t) => corners(t).map((c) => Math.hypot(c.x, c.y)))
      expect(Math.min(...radii)).toBeGreaterThan(rInner)
      expect(Math.max(...radii)).toBeLessThanOrEqual(rOuter)
    })

    // The measurement behind `clearOfHole`'s "it never fires today" note. Kept as
    // an assertion rather than a comment so that the day it stops being true, this
    // fails instead of the guard silently starting to move furniture.
    it('has 78cm of slack between the nearest cover corner and the opening', () => {
      const rInner = holeRadius(topOf(RING))
      const nearest = Math.min(
        ...coversOn(RING).flatMap((t) => corners(t).map((c) => Math.hypot(c.x, c.y))),
      )
      expect(nearest).toBeCloseTo(156.7, 1)
      expect(nearest - rInner).toBeGreaterThan(70)
    })

    // …which leaves the guard itself untested by the real catalog, so drive it:
    // a hole whose edge runs exactly through the cover centres. Every dimension is
    // derived from the real table — only the hole is moved.
    it('pushes a cover back out when a hole DOES reach the seat line', () => {
      const top = topOf(RING)
      const entry = getCatalogEntry(RING)
      const s = entry.seating!
      const cfg = { ...seating(s.defaultCount, s.defaultGap), offset: s.defaultOffset }
      const seats = seatsForEntry(entry, entry.defaultSize, cfg, chair)

      const loose = seatItemTransforms(seats, chair, item, s.defaultOffset)
      const reached = Math.hypot(loose[0].position.x, loose[0].position.y)
      const greedy: Outline = { kind: 'circle', r: top.kind === 'circle' ? top.r : 0, rInner: reached }

      for (const t of seatItemTransforms(seats, chair, item, s.defaultOffset, greedy)) {
        // pushed out far enough that the whole footprint clears the opening
        for (const c of corners(t)) expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(reached - 1e-9)
        expect(Math.hypot(t.position.x, t.position.y)).toBeGreaterThan(reached)
      }
    })

    it('keeps every cover inside the serpentine band', () => {
      const covers = coversOn('table.serpentine')
      expect(covers).toHaveLength(getCatalogEntry('table.serpentine').seating!.defaultCount)
      const depths = covers.flatMap((t) => corners(t).map((c) => serpentineBandDepth(c)))
      // no corner leaves the band, and the tightest one still has 2cm of drape
      expect(Math.min(...depths)).toBeGreaterThan(0)
      expect(Math.min(...depths)).toBeCloseTo(2.1, 0)
    })

    // The straight push in from the seat is what §43 suspected of leaving the
    // curve. It does not: on both flanks and at both heads the cover ends up the
    // same 3cm + half its depth inside whichever band edge its seat was measured
    // from, because the seat's own front is radial to the arc it sits on.
    it('sets every serpentine cover the same depth inside the band edge', () => {
      const inset = 3 + item.depth / 2
      const flanks = coversOn('table.serpentine').filter(
        (t) => Math.abs(serpentineBandDepth(t.position) - inset) < 1e-6,
      )
      // 20 flank seats; the two heads run in along the cap instead and sit on the
      // centre line, which is the deepest a cover ever gets (deliberate — FOUND-02 §2)
      expect(flanks).toHaveLength(20)
    })
  })

  it('admits the ⌀180 × 12 corner clip rather than hiding it', () => {
    const round = getCatalogEntry('table.round')
    const items = coversOn('table.round')
    expect(items).toHaveLength(round.seating!.defaultCount)
    const r = Math.hypot(items[0].position.x, items[0].position.y)
    expect(r).toBeCloseTo(round.defaultSize.width / 2 - 3 - item.depth / 2)
    expect((2 * Math.PI * r) / items.length).toBeGreaterThan(item.width)
    expect(worstInlineOverlap(items)).toBeCloseTo(5.7, 0)
  })
})
