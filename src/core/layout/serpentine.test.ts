import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { SeatingConfig, Size3D } from '../model/types'
import { rotateVec } from '../space'
import {
  SERPENTINE_ARCS,
  SERPENTINE_BAND,
  serpentineArcs,
  serpentineBounds,
  serpentineMaxSeats,
  serpentineSeats,
} from './serpentine'

const chair: Size3D = { width: 45, depth: 45, height: 92 }
const seating = (count: number): SeatingConfig => ({
  enabled: true,
  chairCatalogId: 'chair.x-white',
  count,
  gap: 10,
  offset: 6,
  startAngle: 0,
})

/** The prepped GLB this geometry was fitted to, measured after glb-prep. */
const GLB = { width: 422, depth: 422, height: 75 }
/** Capacity with the house chair at the entry's default gap/offset. */
const SEATS = 20
const LONG_FLANK = 11
const SHORT_FLANK = 9

const rad = (d: number) => (d * Math.PI) / 180

/** Nearest point of the centre line to `p`, the distance, and its arc. */
function toCenterLine(p: { x: number; y: number }) {
  let best = { dist: Infinity, x: 0, y: 0, arc: SERPENTINE_ARCS[0] }
  for (const a of SERPENTINE_ARCS) {
    for (let t = 0; t <= Math.abs(a.turn); t += 0.05) {
      const th = rad(a.from + Math.sign(a.turn) * t)
      const x = a.cx + Math.cos(th) * a.r
      const y = a.cy + Math.sin(th) * a.r
      const dist = Math.hypot(p.x - x, p.y - y)
      if (dist < best.dist) best = { dist, x, y, arc: a }
    }
  }
  return best
}

/**
 * Which flank of the band a seat is on, in the ±1 the layout uses: outside the
 * arc it is nearest to, corrected for that arc's curvature flipping at a join.
 */
function flankOf(p: { x: number; y: number }): number {
  const near = toCenterLine(p)
  const outside = Math.hypot(p.x - near.arc.cx, p.y - near.arc.cy) > near.arc.r ? 1 : -1
  const flip = Math.sign(near.arc.turn) === Math.sign(SERPENTINE_ARCS[0].turn) ? 1 : -1
  return outside * flip
}

const centerLineLength = () =>
  SERPENTINE_ARCS.reduce((t, a) => t + rad(Math.abs(a.turn)) * a.r, 0)

/** Seat-line length on one flank — the same sum the layout walks. */
const flankLength = (side: number, d: number) =>
  SERPENTINE_ARCS.reduce((t, a) => {
    const flip = Math.sign(a.turn) === Math.sign(SERPENTINE_ARCS[0].turn) ? 1 : -1
    return t + rad(Math.abs(a.turn)) * Math.max(0, a.r + side * flip * d)
  }, 0)

const seatD = SERPENTINE_BAND / 2 + 6 + chair.depth / 2

describe('serpentine geometry', () => {
  it('has the width the user specified and the length the model happens to have', () => {
    // 80 is a DECISION — the real table's dining width, which the GLB was scaled
    // to. 580 is not: it is this Tripo model's proportions, about 1:7 against the
    // real table's 1:3.75. If either moves, the GLB was re-prepped and the arcs
    // have to be re-fitted with it.
    expect(SERPENTINE_BAND).toBe(80)
    expect(centerLineLength()).toBeCloseTo(580, -1)
  })

  it('keeps its centred conservative bounds within 10cm of the prepped GLB', () => {
    const { width, depth } = serpentineBounds()
    // The fitted band is offset a few centimetres in the model frame. Its
    // centred outline may therefore be slightly larger than the GLB's total
    // extent, but never enough to indicate a scale or fit mismatch.
    expect(Math.abs(GLB.width - width)).toBeLessThanOrEqual(10)
    expect(Math.abs(GLB.depth - depth)).toBeLessThanOrEqual(10)
  })

  it('bounds contain every corner of every drawn arc', () => {
    const { width, depth } = serpentineBounds()
    for (const a of serpentineArcs()) {
      for (const t of [0, a.sweep / 2, a.sweep]) {
        for (const radius of [a.innerR, a.outerR]) {
          const th = rad(a.startAngle + t)
          expect(Math.abs(a.cx + Math.cos(th) * radius)).toBeLessThanOrEqual(width / 2 + 0.01)
          expect(Math.abs(a.cy + Math.sin(th) * radius)).toBeLessThanOrEqual(depth / 2 + 0.01)
        }
      }
    }
  })

  it('draws annular sectors that meet tangentially, with a curvature flip', () => {
    const parts = serpentineArcs()
    expect(parts).toHaveLength(SERPENTINE_ARCS.length)
    // Konva reads a negative angle as the 360° complement, so every sweep must
    // come out positive with the start angle moved back instead
    for (const p of parts) expect(p.sweep).toBeGreaterThan(0)

    const at = (a: (typeof SERPENTINE_ARCS)[number], t: number) => {
      const th = rad(a.from + t)
      return { x: a.cx + Math.cos(th) * a.r, y: a.cy + Math.sin(th) * a.r }
    }
    const tangent = (a: (typeof SERPENTINE_ARCS)[number], t: number) => {
      const th = rad(a.from + t)
      const s = Math.sign(a.turn)
      return { x: -Math.sin(th) * s, y: Math.cos(th) * s }
    }
    for (let i = 1; i < SERPENTINE_ARCS.length; i++) {
      const prev = SERPENTINE_ARCS[i - 1]
      const next = SERPENTINE_ARCS[i]
      // consecutive arcs share the join point …
      const end = at(prev, prev.turn)
      const start = at(next, 0)
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(0, 6)
      // … and the same tangent there, which is what stops the band kinking
      const tA = tangent(prev, prev.turn)
      const tB = tangent(next, 0)
      expect(tA.x * tB.x + tA.y * tB.y).toBeCloseTo(1, 6)
    }
    // an S, not a C: the curvature has to reverse somewhere along the chain
    expect(new Set(SERPENTINE_ARCS.map((a) => Math.sign(a.turn))).size).toBe(2)
  })
})

describe('serpentine seats', () => {
  it(`seats ${SEATS} — ${LONG_FLANK} on the long flank, ${SHORT_FLANK} on the short`, () => {
    expect(serpentineMaxSeats(seating(99), chair)).toBe(SEATS)
    const seats = serpentineSeats(seating(SEATS), chair)
    expect(seats).toHaveLength(SEATS)
    expect(seats.filter((s) => flankOf(s.position) === 1)).toHaveLength(LONG_FLANK)
    expect(seats.filter((s) => flankOf(s.position) === -1)).toHaveLength(SHORT_FLANK)

    // every chair sits exactly one seat-offset off the centre line
    for (const s of seats) expect(toCenterLine(s.position).dist).toBeCloseTo(seatD, 0)
  })

  it('the flanks differ by 2·d·Σ(flank·|turn|), so capacity depends on chair depth', () => {
    // The symmetric-S model this replaced had one shared sweep, and then the
    // r+d / r−d offsets cancelled exactly. They do not cancel for a chain whose
    // arcs sweep through different angles: the difference below is over a metre,
    // which is why one flank seats more chairs than the other, and why a deeper
    // chair changes the total rather than leaving it alone.
    const expected =
      2 *
      seatD *
      SERPENTINE_ARCS.reduce((t, a) => {
        const flip = Math.sign(a.turn) === Math.sign(SERPENTINE_ARCS[0].turn) ? 1 : -1
        return t + flip * rad(Math.abs(a.turn))
      }, 0)
    expect(flankLength(1, seatD) - flankLength(-1, seatD)).toBeCloseTo(expected, 6)
    // whatever the split, the two flanks together are twice the centre line
    expect(flankLength(1, seatD) + flankLength(-1, seatD)).toBeCloseTo(2 * centerLineLength(), 6)
    expect(flankLength(1, seatD)).toBeGreaterThan(flankLength(-1, seatD))

    // A deeper chair sits further out, which LENGTHENS the flank outside the
    // long arcs and SHORTENS the one inside them. In the old symmetric model
    // that was provably impossible — the two changes cancelled exactly — so this
    // monotonicity is the property that replaced "capacity is depth-independent".
    const deeper = (depth: number) => SERPENTINE_BAND / 2 + 6 + depth / 2
    expect(flankLength(1, deeper(80))).toBeGreaterThan(flankLength(1, seatD))
    expect(flankLength(-1, deeper(80))).toBeLessThan(flankLength(-1, seatD))

    // and it really does move the seat count, though only once the change
    // crosses a whole chair — at 45 vs 80 deep the total happens to land back on
    // the same 20, so a test comparing just those two would prove nothing
    const capLong = (depth: number) =>
      Math.floor(flankLength(1, deeper(depth)) / (chair.width + 10))
    expect(capLong(100)).toBeGreaterThan(capLong(30))
  })

  it('every chair faces the table', () => {
    for (const s of serpentineSeats(seating(SEATS), chair)) {
      const front = rotateVec({ x: 0, y: -1 }, s.rotation)
      const near = toCenterLine(s.position)
      const toTable = {
        x: (near.x - s.position.x) / near.dist,
        y: (near.y - s.position.y) / near.dist,
      }
      expect(front.x * toTable.x + front.y * toTable.y).toBeGreaterThan(0.99)
    }
  })

  it('does not collide at an inflection point', () => {
    // the naive "outer + inner edge per arc" model puts two chairs on the same
    // spot where the curvature flips; walking each edge continuously does not
    const seats = serpentineSeats(seating(SEATS), chair)
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const gap = Math.hypot(
          seats[i].position.x - seats[j].position.x,
          seats[i].position.y - seats[j].position.y,
        )
        expect(gap).toBeGreaterThan(chair.width * 0.9)
      }
    }
  })

  it('spaces neighbours on a flank evenly', () => {
    const seats = serpentineSeats(seating(SEATS), chair)
    // Seats are spaced evenly by ARC length, so their straight-line gaps are not
    // identical: a chord is shorter than its arc, and more so on a tighter
    // radius. Equal chords would actually mean the walk had gone wrong.
    for (const side of [seats.slice(0, LONG_FLANK), seats.slice(LONG_FLANK)]) {
      const gaps = side
        .slice(1)
        .map((s, i) => Math.hypot(s.position.x - side[i].position.x, s.position.y - side[i].position.y))
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
      for (const g of gaps) expect(Math.abs(g - mean)).toBeLessThan(2.5)
      // and no gap may fall under the chair itself — that would be a collision
      expect(Math.min(...gaps)).toBeGreaterThan(chair.width)
    }
  })

  it('honours a partial count and splits it across both flanks', () => {
    expect(serpentineSeats(seating(10), chair)).toHaveLength(10)
    expect(serpentineSeats(seating(1), chair)).toHaveLength(1)
    expect(serpentineSeats(seating(0), chair)).toHaveLength(0)

    // filling the flanks alternately means an even count lands 5/5 rather than
    // packing the long flank first and leaving one side of the table bare
    const seats = serpentineSeats(seating(10), chair)
    expect(seats.filter((s) => flankOf(s.position) === 1)).toHaveLength(5)
    expect(seats.filter((s) => flankOf(s.position) === -1)).toHaveLength(5)
  })

  it('overflows onto the long flank once the short one is full', () => {
    const seats = serpentineSeats(seating(SEATS), chair)
    expect(seats.filter((s) => flankOf(s.position) === -1)).toHaveLength(SHORT_FLANK)
    expect(LONG_FLANK).toBeGreaterThan(SHORT_FLANK)
  })

  it('clamps a count above capacity', () => {
    expect(serpentineSeats(seating(99), chair)).toHaveLength(SEATS)
  })

  it('the catalog entry declares the capacity and size this math produces', () => {
    // the entry's max/defaultCount/defaultSize are hand-written; this is what
    // stops them drifting away from the geometry and the asset after a re-fit
    const entry = getCatalogEntry('table.serpentine')
    const house = getCatalogEntry(entry.seating!.defaultChair).defaultSize
    const cfg = {
      ...seating(99),
      gap: entry.seating!.defaultGap,
      offset: entry.seating!.defaultOffset,
    }
    expect(entry.seats).toBe(serpentineSeats)
    expect(entry.seating!.max).toBe(serpentineMaxSeats(cfg, house))
    expect(entry.seating!.defaultCount).toBe(serpentineMaxSeats(cfg, house))
    expect(entry.defaultSize).toEqual(GLB)
  })
})
