import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { SeatingConfig, Size3D } from '../model/types'
import { rotateVec } from '../space'
import {
  computeMaxSeats,
  computeSeatTransforms,
  maxGapForSeats,
  maxSeatsForEntry,
} from './seatLayout'

const chair: Size3D = { width: 45, depth: 45, height: 90 }
const seating = (count: number): SeatingConfig => ({
  enabled: true,
  chairCatalogId: 'chair.banquet',
  count,
  gap: 10,
  offset: 6,
  startAngle: 0,
})

describe('circle seats', () => {
  const outline = { kind: 'circle', r: 90 } as const

  it('places N chairs at a uniform radius with uniform angular spacing', () => {
    const seats = computeSeatTransforms(outline, seating(10), chair)
    expect(seats).toHaveLength(10)
    const expectedR = 90 + 6 + chair.depth / 2
    for (const s of seats) {
      expect(Math.hypot(s.position.x, s.position.y)).toBeCloseTo(expectedR)
    }
    // uniform 36° steps
    for (let i = 0; i < seats.length; i++) {
      const a = (Math.atan2(seats[i].position.y, seats[i].position.x) * 180) / Math.PI
      const diff = (((a - i * 36) % 360) + 360) % 360
      expect(Math.min(diff, 360 - diff)).toBeCloseTo(0, 5)
    }
  })

  it('every chair faces the table center', () => {
    for (const s of computeSeatTransforms(outline, seating(8), chair)) {
      const front = rotateVec({ x: 0, y: -1 }, s.rotation)
      const toCenter = {
        x: -s.position.x / Math.hypot(s.position.x, s.position.y),
        y: -s.position.y / Math.hypot(s.position.x, s.position.y),
      }
      expect(front.x).toBeCloseTo(toCenter.x)
      expect(front.y).toBeCloseTo(toCenter.y)
    }
  })

  it('clamps to physical capacity', () => {
    const max = computeMaxSeats(outline, seating(99), chair)
    expect(max).toBe(13) // circumference 2π·118.5 ≈ 744.6 / (45+10)
    expect(computeSeatTransforms(outline, seating(99), chair)).toHaveLength(13)
  })
})

describe('rect seats', () => {
  const outline = { kind: 'rect', w: 180, h: 90 } as const

  it('distributes proportionally to side lengths', () => {
    const seats = computeSeatTransforms(outline, seating(6), chair)
    expect(seats).toHaveLength(6)
    const top = seats.filter((s) => s.position.y < -45)
    const bottom = seats.filter((s) => s.position.y > 45)
    const right = seats.filter((s) => s.position.x > 90)
    const left = seats.filter((s) => s.position.x < -90)
    expect(top).toHaveLength(2)
    expect(bottom).toHaveLength(2)
    expect(right).toHaveLength(1)
    expect(left).toHaveLength(1)
  })

  it('chairs on each side face the table', () => {
    const seats = computeSeatTransforms(outline, seating(6), chair)
    for (const s of seats) {
      const front = rotateVec({ x: 0, y: -1 }, s.rotation)
      // front must point back toward the table center (origin)
      const dot = front.x * -s.position.x + front.y * -s.position.y
      expect(dot).toBeGreaterThan(0)
    }
  })

  it('offsets chairs clear of the table edge', () => {
    const seats = computeSeatTransforms(outline, seating(4), chair)
    for (const s of seats) {
      const insideX = Math.abs(s.position.x) < 90 + 6 + chair.depth / 2 - 0.01
      const insideY = Math.abs(s.position.y) < 45 + 6 + chair.depth / 2 - 0.01
      expect(insideX && insideY).toBe(false)
    }
  })

  it('caps at perimeter capacity', () => {
    // 180/55=3 per long side, 90/55=1 per short side → 8
    expect(computeMaxSeats(outline, seating(99), chair)).toBe(8)
    expect(computeSeatTransforms(outline, seating(99), chair)).toHaveLength(8)
  })
})

describe('square table (160×160) seats', () => {
  const outline = { kind: 'rect', w: 160, h: 160 } as const
  const withGap = (count: number, gap: number): SeatingConfig => ({ ...seating(count), gap })

  it('seats 12 at the catalog gap of 8 — 3 to a side', () => {
    // unit 45+8=53 → ⌊160/53⌋ = 3 per side, 1cm of slack on the third chair
    expect(computeMaxSeats(outline, withGap(99, 8), chair)).toBe(12)
    const seats = computeSeatTransforms(outline, withGap(12, 8), chair)
    expect(seats).toHaveLength(12)
    expect(seats.filter((s) => s.position.y < -80)).toHaveLength(3)
    expect(seats.filter((s) => s.position.y > 80)).toHaveLength(3)
    expect(seats.filter((s) => s.position.x > 80)).toHaveLength(3)
    expect(seats.filter((s) => s.position.x < -80)).toHaveLength(3)
  })

  it('spaces the three chairs on a side evenly', () => {
    const seats = computeSeatTransforms(outline, withGap(12, 8), chair)
    const top = seats.filter((s) => s.position.y < -80).map((s) => s.position.x).sort((a, b) => a - b)
    expect(top).toHaveLength(3)
    top.forEach((x, i) => expect(x).toBeCloseTo((i - 1) * (160 / 3), 9))
  })

  it('drops to 8 at gap 9 — which is why the inspector caps the field', () => {
    // unit 54 → ⌊160/54⌋ = 2 per side. One nudge of a free 0–60 field used to
    // delete four chairs silently; maxGapForSeats is what stops it.
    expect(computeMaxSeats(outline, withGap(99, 9), chair)).toBe(8)
  })
})

describe('maxGapForSeats', () => {
  const entryOf = (id: string) => getCatalogEntry(id)
  const cfg = (): SeatingConfig => seating(99)
  const gapFor = (id: string) => {
    const entry = entryOf(id)
    const cap = entry.seating!
    const house = entryOf(cap.defaultChair).defaultSize
    return maxGapForSeats(entry, entry.defaultSize, { ...cfg(), offset: cap.defaultOffset }, house, cap.defaultCount)
  }

  it('is exactly the catalog default on the tables where gap is load-bearing', () => {
    // both sit one centimetre below a step: 160 takes three 53cm units, not 54;
    // 480 takes nine. The cap must land ON the default, not above it.
    expect(gapFor('table.square')).toBe(8)
    expect(gapFor('table.knights-480')).toBe(8)
  })

  it('leaves room to spare where capacity is not tight', () => {
    // the ⌀180 seats its 12 with slack, so the field stays usefully wide
    expect(gapFor('table.round')).toBeGreaterThan(12)
  })

  it('never reports a gap that loses a chair', () => {
    for (const id of ['table.square', 'table.knights-480', 'table.round', 'table.round-large', 'table.banquet', 'table.serpentine']) {
      const entry = entryOf(id)
      const cap = entry.seating!
      const house = entryOf(cap.defaultChair).defaultSize
      const base = { ...cfg(), offset: cap.defaultOffset }
      const gap = maxGapForSeats(entry, entry.defaultSize, base, house, cap.defaultCount)
      expect(maxSeatsForEntry(entry, entry.defaultSize, { ...base, gap }, house)).toBeGreaterThanOrEqual(cap.defaultCount)
      // and it is the LARGEST such gap — one more loses a chair
      if (gap < 60) {
        expect(maxSeatsForEntry(entry, entry.defaultSize, { ...base, gap: gap + 1 }, house)).toBeLessThan(cap.defaultCount)
      }
    }
  })
})

describe('knights table (480×120) seats', () => {
  const outline = { kind: 'rect', w: 480, h: 120 } as const
  const withGap = (count: number, gap: number): SeatingConfig => ({ ...seating(count), gap })

  it('seats exactly 22 at the catalog gap of 8', () => {
    // unit 45+8=53 → 2·⌊480/53⌋ + 2·⌊120/53⌋ = 2·9 + 2·2
    expect(computeMaxSeats(outline, withGap(99, 8), chair)).toBe(22)
    expect(computeSeatTransforms(outline, withGap(22, 8), chair)).toHaveLength(22)
  })

  it('splits 9+9 along the long sides and 2+2 across the ends', () => {
    const seats = computeSeatTransforms(outline, withGap(22, 8), chair)
    const top = seats.filter((s) => s.position.y < -60)
    const bottom = seats.filter((s) => s.position.y > 60)
    const right = seats.filter((s) => s.position.x > 240)
    const left = seats.filter((s) => s.position.x < -240)
    expect(top).toHaveLength(9)
    expect(bottom).toHaveLength(9)
    expect(right).toHaveLength(2)
    expect(left).toHaveLength(2)
  })

  it('loses two seats at gap 9 — the catalog default of 8 is load-bearing', () => {
    // unit 54 → ⌊480/54⌋ drops to 8; reconcileSeats would silently delete two chairs
    expect(computeMaxSeats(outline, withGap(99, 9), chair)).toBe(20)
    expect(computeSeatTransforms(outline, withGap(22, 9), chair)).toHaveLength(20)
  })
})
