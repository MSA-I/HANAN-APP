import { describe, expect, it } from 'vitest'
import { collectSnapLines, snapAABB, snapValue } from './snapping'

describe('snapValue', () => {
  it('rounds to the nearest grid step', () => {
    expect(snapValue(103, 10)).toBe(100)
    expect(snapValue(107, 10)).toBe(110)
    expect(snapValue(-13, 10)).toBe(-10)
  })
})

describe('snapAABB', () => {
  const staticBox = { minX: 100, minY: 100, maxX: 200, maxY: 200 }
  const lines = collectSnapLines([staticBox])

  it('snaps a near edge to a neighbor edge and reports the guide', () => {
    const moving = { minX: 203, minY: 300, maxX: 253, maxY: 350 }
    const r = snapAABB(moving, lines, 8, null)
    expect(r.dx).toBe(-3) // minX 203 → 200
    expect(r.guideX).toBe(200)
    expect(r.guideY).toBeNull()
  })

  it('snaps centers to centers', () => {
    const moving = { minX: 128, minY: 400, maxX: 168, maxY: 440 } // cx=148, near 150
    const r = snapAABB(moving, lines, 8, null)
    expect(r.dx).toBe(2)
    expect(r.guideX).toBe(150)
  })

  it('falls back to grid when no line is in range', () => {
    const moving = { minX: 495, minY: 495, maxX: 545, maxY: 545 } // center 520
    const r = snapAABB(moving, lines, 8, 50)
    expect(r.dx).toBe(-20) // center 520 → 500
    expect(r.dy).toBe(-20)
    expect(r.guideX).toBeNull()
  })

  it('prefers the closest line', () => {
    const other = { minX: 260, minY: 100, maxX: 300, maxY: 200 }
    const both = collectSnapLines([staticBox, other])
    const moving = { minX: 258, minY: 300, maxX: 298, maxY: 340 }
    const r = snapAABB(moving, both, 8, null)
    expect(r.dx).toBe(2) // 258 → 260 (closer than 258→...)
    expect(r.guideX).toBe(260)
  })
})
