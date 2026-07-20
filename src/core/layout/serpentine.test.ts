import { describe, expect, it } from 'vitest'
import type { SeatingConfig, Size3D } from '../model/types'
import { rotateVec } from '../space'
import {
  SERPENTINE,
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

/** Nearest point of the S's centre line to `p`, and the distance to it. */
function toCenterLine(p: { x: number; y: number }) {
  const { r, sweep } = SERPENTINE
  let best = { dist: Infinity, x: 0, y: 0 }
  for (const cy of [-r, r]) {
    const from = cy < 0 ? 90 : 270
    for (let t = 0; t <= sweep; t += 0.05) {
      const rad = ((from + t) * Math.PI) / 180
      const x = Math.cos(rad) * r
      const y = cy + Math.sin(rad) * r
      const dist = Math.hypot(p.x - x, p.y - y)
      if (dist < best.dist) best = { dist, x, y }
    }
  }
  return best
}

describe('serpentine geometry', () => {
  it('derives its bounding box from the three constants', () => {
    const { width, depth } = serpentineBounds()
    expect(width).toBeCloseTo(588.9, 1)
    expect(depth).toBeCloseTo(340, 1)
  })

  it('bounds contain every corner of both drawn arcs', () => {
    const { width, depth } = serpentineBounds()
    for (const a of serpentineArcs()) {
      for (const t of [0, a.sweep / 2, a.sweep]) {
        for (const radius of [a.innerR, a.outerR]) {
          const rad = ((a.startAngle + t) * Math.PI) / 180
          expect(Math.abs(a.cx + Math.cos(rad) * radius)).toBeLessThanOrEqual(width / 2 + 0.01)
          expect(Math.abs(a.cy + Math.sin(rad) * radius)).toBeLessThanOrEqual(depth / 2 + 0.01)
        }
      }
    }
  })

  it('draws the band as exactly two annular sectors meeting at the origin', () => {
    const arcs = serpentineArcs()
    expect(arcs).toHaveLength(2)
    for (const a of arcs) {
      // the end of each sector that touches the origin
      const rad = ((a.cy < 0 ? a.startAngle : a.startAngle) * Math.PI) / 180
      const mid = (a.innerR + a.outerR) / 2
      expect(Math.hypot(Math.cos(rad) * mid, a.cy + Math.sin(rad) * mid)).toBeCloseTo(0, 6)
    }
  })
})

describe('serpentine seats', () => {
  it('seats exactly 22, eleven to a side', () => {
    expect(serpentineMaxSeats(seating(99), chair)).toBe(22)
    const seats = serpentineSeats(seating(22), chair)
    expect(seats).toHaveLength(22)

    // the two sides sit on opposite flanks of the centre line at the join
    const d = SERPENTINE.band / 2 + 6 + chair.depth / 2
    for (const s of seats) {
      expect(toCenterLine(s.position).dist).toBeCloseTo(d, 0)
    }
  })

  it('capacity depends only on r and sweep — the two sides cancel the offset', () => {
    // a much deeper chair changes d but not the seat-line length, so still 22
    const deep: Size3D = { width: 45, depth: 80, height: 92 }
    expect(serpentineMaxSeats(seating(99), deep)).toBe(22)
  })

  it('every chair faces the table', () => {
    for (const s of serpentineSeats(seating(22), chair)) {
      const front = rotateVec({ x: 0, y: -1 }, s.rotation)
      const near = toCenterLine(s.position)
      const toTable = {
        x: (near.x - s.position.x) / near.dist,
        y: (near.y - s.position.y) / near.dist,
      }
      expect(front.x * toTable.x + front.y * toTable.y).toBeGreaterThan(0.99)
    }
  })

  it('does not collide at the inflection point', () => {
    // the naive "outer + inner edge per arc" model puts two chairs on the same
    // spot where the curvature flips; walking each edge continuously does not
    const seats = serpentineSeats(seating(22), chair)
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

  it('spaces neighbours on a side evenly', () => {
    const seats = serpentineSeats(seating(22), chair)
    const side = seats.slice(0, 11)
    const gaps = side
      .slice(1)
      .map((s, i) => Math.hypot(s.position.x - side[i].position.x, s.position.y - side[i].position.y))
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 0)
  })

  it('honours a partial count and splits it across both sides', () => {
    expect(serpentineSeats(seating(14), chair)).toHaveLength(14)
    expect(serpentineSeats(seating(1), chair)).toHaveLength(1)
    expect(serpentineSeats(seating(0), chair)).toHaveLength(0)
  })

  it('clamps a count above capacity', () => {
    expect(serpentineSeats(seating(99), chair)).toHaveLength(22)
  })
})
