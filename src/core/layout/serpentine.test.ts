import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { SeatingConfig, Size3D } from '../model/types'
import { rotateVec } from '../space'
import { seatItemTransforms } from './seatItemLayout'
import { seatItemSeatsForEntry, seatsForEntry } from './seatLayout'
import {
  ARC_TILE,
  SERPENTINE_ARCS,
  SERPENTINE_BAND,
  pointInSerpentineBand,
  serpentineArcs,
  serpentineBandDepth,
  serpentineBandTiles,
  serpentineBounds,
  serpentineCentre,
  serpentineMaxSeats,
  serpentineSeats,
  snapIntoSerpentineBand,
} from './serpentine'

/**
 * The chair and the seating config are READ FROM THE CATALOG, never typed in.
 *
 * Half of this file's job is to catch the catalog drifting away from the geometry,
 * and a frozen copy of the catalog's own numbers cannot do that — it just agrees
 * with whatever it was written against while the app seats a different number
 * (AGENT-BRIEF §1.7; round 2 lost two rounds to exactly this, `c43d989`).
 *
 * The two constants that stay frozen below are the ones that come from OUTSIDE the
 * code — the prepped asset's bbox and the band width the user specified.
 */
const entry = getCatalogEntry('table.serpentine')
const spec = entry.seating!
const chair: Size3D = getCatalogEntry(spec.defaultChair).defaultSize
const seating = (count: number): SeatingConfig => ({
  enabled: true,
  chairCatalogId: spec.defaultChair,
  count,
  gap: spec.defaultGap,
  offset: spec.defaultOffset,
  startAngle: 0,
})

/** The prepped GLB this geometry was fitted to, measured after glb-prep. */
const GLB = { width: 422, depth: 422, height: 75 }
/** One chair at each end of the S, appended after the two flanks. */
const HEADS = 2

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

const seatD = SERPENTINE_BAND / 2 + spec.defaultOffset + chair.depth / 2

/**
 * What the entry DECLARES it seats. The geometry has to reach this number; the
 * cross-check runs the other way round too, at the end of the seat suite.
 */
const SEATS = spec.defaultCount
/**
 * The per-flank split, derived from the same lengths `capacities()` divides rather
 * than copied out of it — so a chair, gap or offset change moves both together and
 * a re-fit of CHAIN cannot leave a stale 11/9 behind.
 */
const LONG_FLANK = Math.floor(flankLength(1, seatD) / (chair.width + spec.defaultGap))
const SHORT_FLANK = Math.floor(flankLength(-1, seatD) / (chair.width + spec.defaultGap))
const FLANK_SEATS = LONG_FLANK + SHORT_FLANK
/** The flank seats only — the indices a saved project may reference. */
const flanksOf = (seats: { position: { x: number; y: number } }[]) => seats.slice(0, FLANK_SEATS)

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

/**
 * Source doc §53 / §54b — where the band IS, as opposed to where its bounding box
 * says it might be. The box is what the catalog entry declares and what every
 * generic consumer sees; these are the only functions that know better.
 */
describe('serpentine band membership', () => {
  const ORIGIN = { x: 0, y: 0 }

  /** Centre-line samples with the arc length walked to each one. */
  function walk(step = 0.02) {
    const out: { x: number; y: number; s: number }[] = []
    let s = 0
    for (const a of SERPENTINE_ARCS) {
      for (let t = 0; t <= Math.abs(a.turn); t += step) {
        const th = rad(a.from + Math.sign(a.turn) * t)
        out.push({ x: a.cx + Math.cos(th) * a.r, y: a.cy + Math.sin(th) * a.r, s: s + rad(t) * a.r })
      }
      s += rad(Math.abs(a.turn)) * a.r
    }
    return out
  }

  it('THE BUG: the table has no point at its own origin', () => {
    // This one number is the whole of §53. `clampToSurface` pins every
    // `surfaceAnchor:'center'` piece to the parent's (0,0), and all four table
    // designs in presets.ts put their centrepiece there — on a concave S that is
    // over the floor, 63cm shy of the nearest drape edge.
    expect(pointInSerpentineBand(ORIGIN)).toBe(false)
    expect(serpentineBandDepth(ORIGIN)).toBeCloseTo(-63.1, 1)
  })

  it('reads the centre line as exactly half a band deep, everywhere', () => {
    for (const p of walk(0.5)) expect(serpentineBandDepth(p)).toBeCloseTo(SERPENTINE_BAND / 2, 6)
  })

  it('puts both drape edges at zero and anything past them outside', () => {
    for (const p of walk(2)) {
      const near = toCenterLine(p)
      // step off the centre line, perpendicular to it, on the arc it belongs to
      const ux = (p.x - near.arc.cx) / near.arc.r
      const uy = (p.y - near.arc.cy) / near.arc.r
      const at = (t: number) => ({ x: p.x + ux * t, y: p.y + uy * t })
      for (const side of [1, -1]) {
        expect(serpentineBandDepth(at(side * (SERPENTINE_BAND / 2)))).toBeCloseTo(0, 6)
        expect(pointInSerpentineBand(at(side * (SERPENTINE_BAND / 2 + 1)))).toBe(false)
      }
    }
  })

  it('finds a centre on the band, bisecting the centre line by arc length', () => {
    const c = serpentineCentre()
    // "on the centre line", stated analytically rather than against toCenterLine's
    // 0.05° sampling: half a band from both drape edges is true of the centre line
    // and of nothing else
    expect(serpentineBandDepth(c)).toBeCloseTo(SERPENTINE_BAND / 2, 6)

    const line = walk()
    const nearest = line.reduce((a, b) =>
      Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a,
    )
    expect(nearest.s).toBeCloseTo(centerLineLength() / 2, 0)
  })

  /**
   * The choice `serpentineCentre` makes, held against the two it rejects. An
   * average of a concave shape lands in the hollow, and both averages do — so
   * this is not a tie broken on taste.
   */
  it('beats both averages, because both of them are off the table', () => {
    // area centroid of the three annular sectors: each sector's centroid lies on
    // its own bisector at (2/3)·(R³−r³)/(R²−r²)·sinc(sweep/2), area-weighted.
    // They meet tangentially at a point, so the three do not overlap and a plain
    // weighted mean is exact rather than an approximation.
    let ax = 0
    let ay = 0
    let area = 0
    for (const s of serpentineArcs()) {
      const sw = rad(s.sweep)
      const a = (sw / 2) * (s.outerR ** 2 - s.innerR ** 2)
      const d =
        ((2 / 3) * (s.outerR ** 3 - s.innerR ** 3) * Math.sin(sw / 2)) /
        ((s.outerR ** 2 - s.innerR ** 2) * (sw / 2))
      const b = rad(s.startAngle + s.sweep / 2)
      ax += a * (s.cx + Math.cos(b) * d)
      ay += a * (s.cy + Math.sin(b) * d)
      area += a
    }
    const centroid = { x: ax / area, y: ay / area }

    expect(serpentineBandDepth(ORIGIN)).toBeCloseTo(-63.13, 1) // bounding box
    expect(serpentineBandDepth(centroid)).toBeCloseTo(-15.42, 1) // area centroid
    expect(serpentineBandDepth(serpentineCentre())).toBeCloseTo(SERPENTINE_BAND / 2, 6)
    // and the two are 55cm apart, so this is a different answer and not a rounding
    const c = serpentineCentre()
    expect(Math.hypot(centroid.x - c.x, centroid.y - c.y)).toBeCloseTo(55.5, 0)
  })

  it('snaps a point onto the band and leaves an interior one alone', () => {
    const c = serpentineCentre()
    expect(snapIntoSerpentineBand(c)).toBe(c) // identity, not a rebuilt copy

    const pulled = snapIntoSerpentineBand(ORIGIN)
    expect(pointInSerpentineBand(pulled)).toBe(true)
    expect(serpentineBandDepth(pulled)).toBeCloseTo(0, 6) // lands ON the edge with no reach
  })

  it('keeps a whole footprint in when given its reach', () => {
    // a candelabrum-sized piece dropped at the origin and at the four design
    // offsets presets.ts uses, plus the bbox corners the outline would allow
    const reach = 20
    const probes = [
      ORIGIN,
      { x: 38, y: 0 },
      { x: -38, y: 0 },
      { x: 0, y: 100 },
      { x: serpentineBounds().width / 2, y: serpentineBounds().depth / 2 },
      { x: -200, y: 150 },
    ]
    for (const p of probes) {
      const q = snapIntoSerpentineBand(p, reach)
      expect(serpentineBandDepth(q)).toBeGreaterThanOrEqual(reach - 1e-6)
    }
  })

  it('collapses to the centre line for a piece wider than the table', () => {
    // no inset can fit it, so the least-wrong answer is the middle of the band
    const q = snapIntoSerpentineBand(ORIGIN, SERPENTINE_BAND)
    expect(serpentineBandDepth(q)).toBeCloseTo(SERPENTINE_BAND / 2, 6)
  })
})

describe('serpentine seats', () => {
  it(`seats ${SEATS} — ${LONG_FLANK} long flank + ${SHORT_FLANK} short + ${HEADS} heads`, () => {
    expect(serpentineMaxSeats(seating(99), chair)).toBe(SEATS)
    const seats = serpentineSeats(seating(SEATS), chair)
    expect(seats).toHaveLength(SEATS)
    const flanks = flanksOf(seats)
    expect(flanks.filter((s) => flankOf(s.position) === 1)).toHaveLength(LONG_FLANK)
    expect(flanks.filter((s) => flankOf(s.position) === -1)).toHaveLength(SHORT_FLANK)

    // every FLANK chair sits exactly one seat-offset off the centre line. The
    // heads do not: they clear the end cap along the tangent, not the flank.
    for (const s of flanks) expect(toCenterLine(s.position).dist).toBeCloseTo(seatD, 0)
  })

  it('puts the last two chairs at the ends of the S, facing back down the band', () => {
    const seats = serpentineSeats(seating(SEATS), chair)
    const heads = seats.slice(FLANK_SEATS)
    expect(heads).toHaveLength(HEADS)

    // The centre line's own two endpoints — where the band's end caps are.
    const first = SERPENTINE_ARCS[0]
    const last = SERPENTINE_ARCS[SERPENTINE_ARCS.length - 1]
    const at = (a: (typeof SERPENTINE_ARCS)[number], deg: number) => ({
      x: a.cx + Math.cos(rad(deg)) * a.r,
      y: a.cy + Math.sin(rad(deg)) * a.r,
    })
    const tips = [at(first, first.from), at(last, last.from + last.turn)]

    for (const tip of tips) {
      const dist = (h: (typeof heads)[number]) =>
        Math.hypot(h.position.x - tip.x, h.position.y - tip.y)
      const head = heads.reduce((a, b) => (dist(a) <= dist(b) ? a : b))
      // it clears the cap by exactly the chair's own offset — offset + depth/2,
      // measured ALONG the band rather than across it
      const reach = dist(head)
      expect(reach).toBeCloseTo(spec.defaultOffset + chair.depth / 2, 6)
      // and it faces the table: front points from the chair back at the cap
      const front = rotateVec({ x: 0, y: -1 }, head.rotation)
      const toTip = { x: (tip.x - head.position.x) / reach, y: (tip.y - head.position.y) / reach }
      expect(front.x * toTip.x + front.y * toTip.y).toBeCloseTo(1, 6)
    }

    // A head is past the END of the band, not tucked onto a flank: it sits
    // CLOSER to the centre line than any flank chair does, because its clearance
    // is measured along the line instead of across the 80cm band.
    for (const h of heads) expect(toCenterLine(h.position).dist).toBeLessThan(seatD)
  })

  it('keeps the flank seats at the indices they had before the heads existed', () => {
    // reconcileSeats maps a stored chair to a position by array index, so a
    // project saved with 20 chairs must reload on the identical 20 positions —
    // this is why the heads are appended (20, 21) rather than inserted.
    const before = serpentineSeats(seating(FLANK_SEATS), chair)
    const after = serpentineSeats(seating(SEATS), chair)
    expect(before).toHaveLength(FLANK_SEATS)
    expect(after.slice(0, FLANK_SEATS)).toEqual(before)
    // and a count between the two takes one head, not half a flank
    expect(serpentineSeats(seating(FLANK_SEATS + 1), chair)).toHaveLength(FLANK_SEATS + 1)
    expect(serpentineSeats(seating(FLANK_SEATS + 1), chair).slice(0, FLANK_SEATS)).toEqual(before)
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
    const deeper = (depth: number) => SERPENTINE_BAND / 2 + spec.defaultOffset + depth / 2
    expect(flankLength(1, deeper(80))).toBeGreaterThan(flankLength(1, seatD))
    expect(flankLength(-1, deeper(80))).toBeLessThan(flankLength(-1, seatD))

    // and it really does move the seat count, though only once the change
    // crosses a whole chair — at 45 vs 80 deep the total happens to land back on
    // the same 20, so a test comparing just those two would prove nothing
    const capLong = (depth: number) =>
      Math.floor(flankLength(1, deeper(depth)) / (chair.width + spec.defaultGap))
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
    for (const side of [seats.slice(0, LONG_FLANK), seats.slice(LONG_FLANK, FLANK_SEATS)]) {
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
    const seats = flanksOf(serpentineSeats(seating(SEATS), chair))
    expect(seats.filter((s) => flankOf(s.position) === -1)).toHaveLength(SHORT_FLANK)
    expect(LONG_FLANK).toBeGreaterThan(SHORT_FLANK)
  })

  it('clamps a count above capacity', () => {
    expect(serpentineSeats(seating(99), chair)).toHaveLength(SEATS)
  })

  it('the catalog entry declares the capacity and size this math produces', () => {
    // The entry's max/defaultCount/defaultSize are hand-written; this is what stops
    // them drifting away from the geometry and the asset after a re-fit.
    //
    // ⚠ This is also the test that refutes the standing theory about item 27 — that
    // `caps[0]+caps[1]+HEAD_SEATS` never actually reaches the declared 22 and the
    // table silently seats 20. It reaches it: caps come back [11, 9] plus two heads.
    // A chair-size, gap or offset change that broke the 22 would fail HERE, loudly,
    // instead of quietly seating fewer.
    expect(entry.seats).toBe(serpentineSeats)
    expect(serpentineMaxSeats(seating(99), chair)).toBe(spec.defaultCount)
    expect(spec.max).toBe(serpentineMaxSeats(seating(99), chair))
    expect(entry.defaultSize).toEqual(GLB)
  })

  it('appends the two heads LAST — the index contract reconcileSeats maps by', () => {
    // reconcileSeats resolves a stored chair to a position BY ITS INDEX, so this
    // ordering is load-bearing for every saved project: flanks own 0…n−3 and the
    // heads are appended. Reordering them silently moves every saved chair.
    const seats = serpentineSeats(seating(SEATS), chair)
    expect(seats).toHaveLength(SEATS)
    // the split the capacity formula predicts is the split the walk produces, and
    // the two heads are exactly what makes the difference up to the declared count
    expect(FLANK_SEATS + HEADS).toBe(SEATS)
    // …stated positionally as well, so a reorder fails even if the counts survive:
    // a flank seat sits exactly one seat-offset off the centre line. A head does
    // not — it clears the end cap ALONG the band, which puts it closer in.
    for (const s of seats.slice(0, SEATS - HEADS))
      expect(toCenterLine(s.position).dist).toBeCloseTo(seatD, 0)
    for (const h of seats.slice(SEATS - HEADS))
      expect(toCenterLine(h.position).dist).toBeLessThan(seatD - 1)
  })

  it('seats 22 chairs and sets 20 of them', () => {
    // Corrections document item 27: "בשולחן נחש … אין שם 22 כמספר הכסאות". There
    // WERE 22 covers all along; two of them had merged into their neighbours, so the
    // eye counted short. Round 4 §15 is the user's decision on it — keep all 22
    // chairs, lay 20 covers — because no position inside the band clears the head
    // cover (the sweep is on `HEAD_SEATS` in serpentine.ts).
    const cover = getCatalogEntry('decor.place-setting').defaultSize
    const seats = seatsForEntry(entry, entry.defaultSize, seating(SEATS), chair)
    const covered = seatItemSeatsForEntry(entry, entry.defaultSize, seating(SEATS), chair)
    const top = entry.footprint(entry.defaultSize).outline
    expect(seats).toHaveLength(SEATS)
    expect(covered).toHaveLength(FLANK_SEATS)
    expect(SEATS - covered.length).toBe(HEADS)
    expect(seatItemTransforms(covered, chair, cover, spec.defaultOffset, top)).toHaveLength(
      FLANK_SEATS,
    )

    // and the CHAIRS are not the problem either — none of them collides
    const pitch = Math.min(
      ...seats.map((a, i) =>
        Math.min(
          ...seats
            .filter((_, j) => j !== i)
            .map((b) => Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y)),
        ),
      ),
    )
    expect(pitch).toBeGreaterThan(chair.width)
  })

  it('lays a cover on every FLANK seat and on neither head, and none of them touch', () => {
    /**
     * This replaces a test that asserted the defect (`KNOWN OVERLAP`), which its own
     * docblock instructed be deleted the moment the overlap went away. The
     * measurement that justified the fix is kept on `HEAD_SEATS` in serpentine.ts;
     * what belongs here is the positive statement.
     *
     * Why the heads could never work: the two kinds of cover lie at 90° to each
     * other across the band. A FLANK cover has its 31.3 depth radial and sits 21.35
     * off the centre line, occupying [5.70, 37.00] across the 80 band. A HEAD cover
     * sits ON the centre line with its 36 WIDTH across it, spanning [−18, +18]. The
     * free corridor down the middle is 11.4 cm, so the two always interpenetrate.
     *
     * Nearest-neighbour distances before the fix, all 22 covers:
     *   20.2 20.2 21.3 21.3 29.1 40.6 42.7 … 50.2
     * The first four are the two heads against the flank cover at each end of the
     * walk. Drop the heads and the minimum over the remaining 20 becomes the 29.1
     * that was already there — comfortably clear of the 36 cm cover's own width in
     * the direction that matters, which is what the assertion checks.
     */
    const cover = getCatalogEntry('decor.place-setting').defaultSize
    const seats = seatsForEntry(entry, entry.defaultSize, seating(SEATS), chair)
    const covered = seatItemSeatsForEntry(entry, entry.defaultSize, seating(SEATS), chair)
    const top = entry.footprint(entry.defaultSize).outline
    const covers = seatItemTransforms(covered, chair, cover, spec.defaultOffset, top)

    // it is the FLANKS that are covered, positionally and not merely by count: a
    // flank seat sits exactly one seat-offset off the centre line, a head does not
    expect(covers).toHaveLength(FLANK_SEATS)
    expect(seats.length - covered.length).toBe(HEADS)
    for (const s of covered) expect(toCenterLine(s.position).dist).toBeCloseTo(seatD, 0)
    for (const h of seats.slice(FLANK_SEATS)) {
      expect(covered.some((c) => c.position === h.position)).toBe(false)
    }

    const nearest = covers.map((a, i) =>
      Math.min(
        ...covers
          .filter((_, j) => j !== i)
          .map((b) => Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y)),
      ),
    )
    // the whole point: no two covers are closer than one cover is wide. The old
    // worst was 20.2 against a 36 cm cover; it is now the 29.1 that was fifth.
    expect(Math.min(...nearest)).toBeGreaterThan(cover.depth)
    expect(Math.min(...nearest)).toBeGreaterThan(29)
  })

  /**
   * ⚠ The subset is derived from `capacities()`, NOT expressed as "drop the last
   * two" — and this is the case that tells them apart. `serpentineSeats` appends
   * the heads with `.slice(0, max(0, count − out.length))`, so below the flank
   * capacity there are NO heads and a "last two" rule would silently strip two
   * flank covers from a table that never had a head problem.
   */
  it('drops nothing at a count the heads never reach', () => {
    for (const count of [1, 10, FLANK_SEATS - 1, FLANK_SEATS]) {
      const seats = serpentineSeats(seating(count), chair)
      const covered = seatItemSeatsForEntry(entry, entry.defaultSize, seating(count), chair)
      expect(seats).toHaveLength(count)
      expect(covered).toHaveLength(count)
    }
    // and it starts dropping exactly when the heads start appearing
    expect(
      seatItemSeatsForEntry(entry, entry.defaultSize, seating(FLANK_SEATS + 1), chair),
    ).toHaveLength(FLANK_SEATS)
  })
})

/**
 * The shapes COLLISION reads instead of the bounding box (round 4 §15b).
 *
 * The box is 17.99 m² around a 4.644 m² band and its own centre is 63 cm outside
 * the drape, so `TABLE_CLEARANCE.rect = 170` measured off it refused a ⌀180 round
 * table up to about three metres away. The outline stays for its nine consumers;
 * collision alone tiles the sectors.
 *
 * One property matters above the rest and it is the first test here: the tiles must
 * COVER the band. A tile may claim floor the table does not occupy — an object is
 * then refused a centimetre early, which is safe and invisible — but a gap would
 * let a table be placed through the drape.
 */
describe('the collision tiling', () => {
  const tiles = serpentineBandTiles()

  /** Is a point inside a tile? The same rotated-rect test collision.ts runs. */
  const inTile = (p: { x: number; y: number }, t: (typeof tiles)[number]) => {
    const l = rotateVec({ x: p.x - t.cx, y: p.y - t.cy }, -t.rot)
    return Math.abs(l.x) <= t.w / 2 && Math.abs(l.y) <= t.h / 2
  }

  it('is 30 tiles, split the way the arcs are', () => {
    expect(tiles).toHaveLength(30)
    // derived from `serpentineArcs()` — the split follows a re-fit of CHAIN
    const perArc = serpentineArcs().map((s) =>
      Math.ceil((rad(s.sweep) * ((s.innerR + s.outerR) / 2)) / ARC_TILE),
    )
    expect(perArc).toEqual([12, 10, 8])
    expect(perArc.reduce((a, b) => a + b, 0)).toBe(tiles.length)
  })

  it('covers the whole band and over-claims by at most ~5.4 cm', () => {
    const { width, depth } = serpentineBounds()
    let shortfall = 0
    let excess = 0
    let bandCells = 0
    let tiledCells = 0
    // 1.5 cm: fine enough to catch a real gap anywhere, coarse enough to sweep the
    // 4.3 m box in well under a second. The excess creeps up with the sampling —
    // 4.97 here, 5.30 at 0.4 cm — so the bound is stated with room.
    const G = 1.5
    for (let x = -width / 2 - 20; x <= width / 2 + 20; x += G) {
      for (let y = -depth / 2 - 20; y <= depth / 2 + 20; y += G) {
        const p = { x, y }
        const d = serpentineBandDepth(p)
        const hit = tiles.some((t) => inTile(p, t))
        if (d >= 0) {
          bandCells++
          // THE property: every point of the band is inside some tile
          shortfall = Math.max(shortfall, hit ? 0 : d)
        }
        if (hit) tiledCells++
        if (d < 0 && hit) excess = Math.max(excess, -d)
      }
    }
    expect(shortfall).toBe(0)
    expect(excess).toBeLessThanOrEqual(5.5)
    // and the price of covering it is under 1% of extra area
    expect(bandCells).toBeGreaterThan(0)
    expect(tiledCells / bandCells).toBeLessThan(1.02)
  })

  it('derives its area from the arcs rather than from a remembered number', () => {
    // Σ ½·sweep·(outerR² − innerR²) — the exact area of the three sectors
    const area = serpentineArcs().reduce(
      (t, s) => t + 0.5 * rad(s.sweep) * (s.outerR * s.outerR - s.innerR * s.innerR),
      0,
    )
    expect(area / 10000).toBeCloseTo(4.644, 2)
    // the tiles are a cover, so their total area is at least the band's
    const tiled = tiles.reduce((t, s) => t + s.w * s.h, 0)
    expect(tiled).toBeGreaterThan(area)
  })

  /**
   * ⚠ A SIDE EFFECT WORTH KNOWING, AND IT IS NOT ONE-SIDED.
   * `unionBox(parts.map(shapeAABB))` for a serpentine now boxes the TILES rather
   * than the declared outline, so `outOfBounds` — the one rule that reads that
   * union — moves with it. Measured at the fitted arcs, tile extent against the
   * outline's own half-extent:
   *
   *   −x  12.49 cm tighter      +x   4.39 cm tighter
   *   +y  13.44 cm tighter      −y   0.33 cm WIDER
   *
   * So on three sides the table may now be pushed a few centimetres nearer a wall
   * than before, and on the fourth it is refused a third of a centimetre earlier.
   * The −y side is the one place a tile's outward over-claim (≤5.3 cm) beats the
   * gap between the fitted band and the box drawn around it — the outline takes the
   * LARGER of the GLB bbox and the arcs' own box per axis, and on this axis the
   * arcs win by only 4.4 cm.
   *
   * Both directions are more accurate than what they replace: the box the table
   * used to be judged by was never the table.
   */
  it('boxes the tiles, not the outline — three sides looser, one 0.33 cm tighter', () => {
    const outline = getCatalogEntry('table.serpentine').footprint(
      getCatalogEntry('table.serpentine').defaultSize,
    ).outline
    if (outline.kind !== 'rect') throw new Error('the serpentine declares a rect outline')
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const t of tiles) {
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        const c = rotateVec({ x: (sx * t.w) / 2, y: (sy * t.h) / 2 }, t.rot)
        minX = Math.min(minX, t.cx + c.x)
        maxX = Math.max(maxX, t.cx + c.x)
        minY = Math.min(minY, t.cy + c.y)
        maxY = Math.max(maxY, t.cy + c.y)
      }
    }
    // three sides genuinely tighter, by centimetres rather than by rounding
    expect(minX - -outline.w / 2).toBeGreaterThan(10)
    expect(outline.w / 2 - maxX).toBeGreaterThan(4)
    expect(outline.h / 2 - maxY).toBeGreaterThan(10)
    // …and the fourth is not, which is the half of this nobody expects
    expect(-outline.h / 2 - minY).toBeGreaterThan(0)
    expect(-outline.h / 2 - minY).toBeLessThan(1)
  })
})
