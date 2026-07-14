import { describe, expect, it } from 'vitest'
import type { SeatingConfig, Size3D } from '../model/types'
import { rotateVec } from '../space'
import { computeMaxSeats, computeSeatTransforms } from './seatLayout'

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
