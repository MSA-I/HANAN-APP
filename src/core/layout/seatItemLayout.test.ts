import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { Outline } from '../catalog/types'
import type { SeatingConfig, Size3D, Transform2D } from '../model/types'
import { rotateVec } from '../space'
import { holeRadius } from './bounds'
import { EDGE_INSET, seatItemTransforms, tableTopInset } from './seatItemLayout'
import { computeSeatTransforms, seatItemSeatsForEntry, seatsForEntry } from './seatLayout'
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

/**
 * seat offset + half the chair + the edge inset + half the item. Read from
 * `EDGE_INSET` rather than written out, so a change to the styling gap moves the
 * expectation with it (BRIEF §1.7). No table id goes into `lay` below, so no
 * `tableTopInset` is in play here — these two cases are synthetic outlines with
 * no model behind them, and an unmeasured table is exactly the 0-inset path.
 */
const DISTANCE = 6 + chair.depth / 2 + EDGE_INSET + item.depth / 2

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

/**
 * `seatItemSeatsForEntry`, not `seatsForEntry` — the same call `laySeatItems`
 * makes. They differ on exactly one table: the serpentine's two HEAD seats take a
 * chair and no cover (round 4 §15), so this returns 20 there and every seat
 * everywhere else.
 */
function coversOn(tableId: string): Transform2D[] {
  const entry = getCatalogEntry(tableId)
  const s = entry.seating!
  const cfg = { ...seating(s.defaultCount, s.defaultGap), offset: s.defaultOffset }
  const seats = seatItemSeatsForEntry(entry, entry.defaultSize, cfg, chair)
  // the id goes in too, exactly as laySeatItems passes it: it is what selects the
  // table's measured `tableTopInset`
  return seatItemTransforms(seats, chair, item, s.defaultOffset, topOf(tableId), tableId)
}

/** How many covers this table takes — derived, because on one table it is not the
 *  seat count and a frozen 20 here would stop tracking the geometry. */
function coverCount(tableId: string): number {
  const entry = getCatalogEntry(tableId)
  const s = entry.seating!
  const cfg = { ...seating(s.defaultCount, s.defaultGap), offset: s.defaultOffset }
  return seatItemSeatsForEntry(entry, entry.defaultSize, cfg, chair).length
}

/**
 * The outline of the table's USABLE TOP: the declared one pulled in by the
 * measured `tableTopInset`. Derived, never written out — the whole point of
 * `tableTopInset` being a function is that a re-measured model moves this too.
 */
function usableTop(tableId: string): Outline {
  const top = topOf(tableId)
  const inset = tableTopInset(tableId)
  return top.kind === 'circle'
    ? { ...top, r: top.r - inset }
    : { kind: 'rect', w: top.w - 2 * inset, h: top.h - 2 * inset }
}

/** How far a point pokes OUTSIDE an outline; negative when it is inside. */
function outside(p: { x: number; y: number }, o: Outline): number {
  if (o.kind === 'circle') return Math.hypot(p.x, p.y) - o.r
  return Math.max(Math.abs(p.x) - o.w / 2, Math.abs(p.y) - o.h / 2)
}

/** The cover's outermost point along the direction it was pushed in FROM. */
function outboardEdge(t: Transform2D): { x: number; y: number } {
  const front = rotateVec({ x: 0, y: -1 }, t.rotation)
  return {
    x: t.position.x + (front.x * item.depth) / 2,
    y: t.position.y + (front.y * item.depth) / 2,
  }
}

const ALL_TABLES = [
  'table.round',
  'table.round-large',
  'table.square',
  'table.banquet',
  'table.knights-480',
  'table.serpentine',
]

/**
 * Source doc §3/§23, and the evidence images: the covers hung over the drape with
 * daylight under them. The fix is `tableTopInset` — the declared outline is the
 * GLB's bounding box, i.e. the HEM, and the surface a plate stands on is up to
 * 20 cm inside it. So the test is against the usable top, never against
 * `defaultSize`.
 *
 * Every number here is derived: the outlines come from the catalog, the inset from
 * `tableTopInset`, the cover from its own entry. Re-measure a model and these
 * follow it (BRIEF §1.7).
 */
describe('place settings sit on the table TOP, not on its bounding box', () => {
  for (const tableId of ALL_TABLES) {
    // The property the inset actually guarantees, and the one the images are
    // about: the edge the cover was pushed in FROM is inside the usable top,
    // with the styling gap still showing. True on all six.
    it(`keeps every cover's outboard edge ${EDGE_INSET}cm inside ${tableId}'s real top`, () => {
      const top = usableTop(tableId)
      const covers = coversOn(tableId)
      // derived, not `defaultCount`: the serpentine seats 22 and sets 20, and a
      // hardcoded number here would stop tracking the geometry (BRIEF §1.7)
      expect(covers).toHaveLength(coverCount(tableId))
      expect(covers.length).toBeGreaterThan(0)
      for (const t of covers) expect(outside(outboardEdge(t), top)).toBeLessThanOrEqual(-EDGE_INSET + 1e-9)
    })
  }

  // …and on the two ROUND tables the whole rotated footprint is inside it, which
  // is the strongest form of the claim. Verified independently against each
  // model's own rasterised silhouette: 0 of 48 and 0 of 88 cover corners hang
  // over the drape, down from 24 and 44 before the inset existed.
  for (const tableId of ['table.round', 'table.round-large']) {
    it(`keeps every CORNER of every cover on ${tableId}`, () => {
      const top = usableTop(tableId)
      for (const t of coversOn(tableId)) for (const c of corners(t)) expect(outside(c, top)).toBeLessThan(0)
    })
  }

  /**
   * The rectangles cannot make that claim, and this says by how much rather than
   * quietly testing something weaker.
   *
   * `rectSeats` spreads its seats across the FULL declared side length, so the end
   * seat of a run sits beyond where the drape rounds off at the corner. Pulling the
   * covers in along the seat normal — all `tableTopInset` can do — moves them in
   * depth and not along the run, so the overhang bottoms out and stays: measured
   * against the real silhouettes it is 8 corners of 40 on the square, 4 of 48 on
   * the banquet and 12 of 88 on the knights table, every one of them at a run's
   * end. That is the same pre-existing corner defect as the interpenetration in
   * handoff/FOUND-03.md, it belongs to seat ALLOCATION, and it is not this file's
   * to fix. The inset still halved it — before it there were 24, 28 and 50.
   */
  it.each([
    ['table.square', 4.33],
    ['table.banquet', 1.0],
    ['table.knights-480', 11.33],
  ])('admits that %s still overhangs at the ends of its runs, by %scm', (tableId, worst) => {
    const top = usableTop(tableId)
    const over = coversOn(tableId).flatMap((t) => corners(t).map((c) => outside(c, top)))
    expect(Math.max(...over)).toBeCloseTo(worst, 1)
    // and it really is a corner effect: the depth direction is clean
    for (const t of coversOn(tableId)) expect(outside(outboardEdge(t), top)).toBeLessThan(0)
  })
})

/**
 * Source doc §2a and §42: the cover was resized because a full set of them rode on
 * top of each other. This is that claim, checked on every table the venue owns
 * rather than on the round one the plan worked out by hand.
 */
describe('place settings — a full set on every table in the venue', () => {
  // The five that a 0.8 cover clears outright. Re-measured 2026-07-30 at the sizes
  // in the catalog today: ⌀380 3.24 cm, square 17.33, banquet 24.00, knights 17.33,
  // serpentine 4.99.
  //
  // ⚠ The ⌀380's figure is not a round-4 regression: the covers on it are laid on
  // every seat exactly as before, and nothing in §15 touches that table. The 8.6
  // this comment used to quote predates `tableTopInset`, which pulled the whole
  // cover ring 19 cm inward on this table and tightened the pitch with it — the
  // same trade the block at the foot of this file states in full for the ⌀180.
  //
  // Serpentine 4.99 is unchanged by dropping the two head covers, and that is
  // expected rather than lucky: `worstInlineOverlap` already skipped pairs more
  // than 45° apart, and a head cover lies at 90° to every neighbour it had. The
  // heads' overlap was never in this number — it was in the test that used to sit
  // in serpentine.test.ts asserting it.
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

    /**
     * The measurement behind `clearOfHole`'s "it never fires today" note. Kept as
     * an assertion rather than a comment so that the day it stops being true, this
     * fails instead of the guard silently starting to move furniture.
     *
     * ⚠ `tableTopInset` is what makes this worth re-asserting: it pulls the whole
     * cover ring 19 cm INWARD, i.e. straight at the opening, so it is the first
     * change that can ever bring the two into contact. The slack fell from 78.7 cm
     * to 59.9 — still nowhere near — and both the ring and the corner are computed
     * from the catalog here, so a further inset would move them and be seen.
     */
    it('leaves the nearest cover corner 59cm clear of the opening', () => {
      const top = topOf(RING)
      const rInner = holeRadius(top)
      const rOuter = top.kind === 'circle' ? top.r : 0
      const covers = coversOn(RING)

      // where the ring of covers lands, derived from the catalog and the inset
      const rCentre = rOuter - EDGE_INSET - tableTopInset(RING) - item.depth / 2
      for (const t of covers) expect(Math.hypot(t.position.x, t.position.y)).toBeCloseTo(rCentre, 6)
      expect(rCentre).toBeCloseTo(152.35, 2)

      // …and the nearest corner is that ring pulled in by half the cover's depth,
      // splayed out by half its width
      const nearest = Math.min(...covers.flatMap((t) => corners(t).map((c) => Math.hypot(c.x, c.y))))
      expect(nearest).toBeCloseTo(Math.hypot(rCentre - item.depth / 2, item.width / 2), 6)
      expect(nearest).toBeCloseTo(137.88, 1)
      expect(nearest - rInner).toBeGreaterThan(50)
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

      const loose = seatItemTransforms(seats, chair, item, s.defaultOffset, undefined, RING)
      const reached = Math.hypot(loose[0].position.x, loose[0].position.y)
      const greedy: Outline = { kind: 'circle', r: top.kind === 'circle' ? top.r : 0, rInner: reached }

      for (const t of seatItemTransforms(seats, chair, item, s.defaultOffset, greedy, RING)) {
        // pushed out far enough that the whole footprint clears the opening
        for (const c of corners(t)) expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(reached - 1e-9)
        expect(Math.hypot(t.position.x, t.position.y)).toBeGreaterThan(reached)
      }
    })

    it('keeps every cover inside the serpentine band', () => {
      const covers = coversOn('table.serpentine')
      expect(covers).toHaveLength(coverCount('table.serpentine'))
      const depths = covers.flatMap((t) => corners(t).map((c) => serpentineBandDepth(c)))
      // no corner leaves the band, and the tightest one still has 2cm of drape
      expect(Math.min(...depths)).toBeGreaterThan(0)
      expect(Math.min(...depths)).toBeCloseTo(2.1, 0)
    })

    /**
     * The strongest statement of round 4 §15, and the reason this test changed
     * rather than moved: EVERY cover the serpentine now takes is a flank cover.
     *
     * The straight push in from the seat is what §43 suspected of leaving the
     * curve. It does not — a flank cover ends up exactly `inset + depth/2` inside
     * whichever band edge its seat was measured from, because the seat's own front
     * is radial to the arc it sits on. The two HEAD covers were the exception: they
     * ran in along the cap instead and sat ON the centre line, the deepest a cover
     * ever got, and there they interpenetrated both their neighbours by 12…15 cm.
     * They are no longer laid, so the exception is gone and the count is not a
     * separate fact to remember — it is `covers.length`.
     */
    it('sets EVERY serpentine cover the same depth inside the band edge', () => {
      const inset = EDGE_INSET + tableTopInset('table.serpentine') + item.depth / 2
      const covers = coversOn('table.serpentine')
      const flanks = covers.filter(
        (t) => Math.abs(serpentineBandDepth(t.position) - inset) < 1e-6,
      )
      expect(flanks).toHaveLength(covers.length)
      // …and it really is fewer than the chairs, or the line above would pass on a
      // table that still had the head covers and simply agreed with itself
      expect(covers.length).toBeLessThan(
        getCatalogEntry('table.serpentine').seating!.defaultCount,
      )
    })
  })

  /**
   * ⚠ THE PRICE OF `tableTopInset`, STATED IN FULL. The ⌀180 was already over-set
   * at 12 covers; anchoring to the real top makes it worse, and there is nothing in
   * this file that can stop it.
   *
   * 12 covers of 36 cm need 432 cm of circumference. The declared ⌀180 offers 565
   * at the rim, so the arithmetic used to work at the rim — but the cover ring now
   * sits on the REAL top, and 12 covers on a ⌀118.7 circle have 31.1 cm of arc each
   * for a 36 cm cover. They cannot fit, and the pitch (centre to centre, 36.9 cm
   * before, 30.7 now) is below the cover's own width. Measured with the same
   * separating-axis test as everything above: the worst overlap between two
   * neighbours goes from 5.7 cm to 11.7.
   *
   * That is not a regression introduced by choice — before the inset those covers
   * were not overlapping less, they were hanging off the table (24 of their 48
   * corners over the drape, measured against the model's own silhouette). This
   * trades a defect the user photographed for one they did not, and the honest
   * answer is either a smaller cover or fewer than 12 seats on this table. Both are
   * decisions outside this file: the cover's size belongs to entries/tableDecor.ts
   * and the count to entries/tables.ts.
   */
  it('admits that a full 12 on the ⌀180 now overlap, and by how much', () => {
    const round = getCatalogEntry('table.round')
    const items = coversOn('table.round')
    expect(items).toHaveLength(round.seating!.defaultCount)

    const r = Math.hypot(items[0].position.x, items[0].position.y)
    expect(r).toBeCloseTo(
      round.defaultSize.width / 2 - EDGE_INSET - tableTopInset('table.round') - item.depth / 2,
    )
    // there is no longer a cover's width of arc each — this is the over-set claim
    expect((2 * Math.PI * r) / items.length).toBeLessThan(item.width)
    expect((2 * Math.PI * r) / items.length).toBeCloseTo(31.1, 1)
    expect(worstInlineOverlap(items)).toBeCloseTo(11.7, 1)
  })
})
