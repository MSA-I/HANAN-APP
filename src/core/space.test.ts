import { describe, expect, it } from 'vitest'
import {
  composeTransform,
  normalizeDeg,
  planToThree,
  relativeTransform,
  rotateVec,
  threeToPlan,
} from './space'

describe('rotateVec (clockwise, y-down plan space)', () => {
  it('rotates right-pointing vector down at 90°', () => {
    const v = rotateVec({ x: 1, y: 0 }, 90)
    expect(v.x).toBeCloseTo(0)
    expect(v.y).toBeCloseTo(1)
  })

  it('is inverse for negative angle', () => {
    const v = rotateVec(rotateVec({ x: 3, y: -2 }, 37), -37)
    expect(v.x).toBeCloseTo(3)
    expect(v.y).toBeCloseTo(-2)
  })
})

describe('composeTransform / relativeTransform', () => {
  const parent = { position: { x: 100, y: 50 }, rotation: 90, elevation: 0 }
  const local = { position: { x: 10, y: 0 }, rotation: 15, elevation: 5 }

  it('composes child into world space', () => {
    const world = composeTransform(parent, local)
    // (10,0) rotated 90° cw → (0,10)
    expect(world.position.x).toBeCloseTo(100)
    expect(world.position.y).toBeCloseTo(60)
    expect(world.rotation).toBe(105)
    expect(world.elevation).toBe(5)
  })

  it('relativeTransform inverts composeTransform', () => {
    const world = composeTransform(parent, local)
    const back = relativeTransform(parent, world)
    expect(back.position.x).toBeCloseTo(local.position.x)
    expect(back.position.y).toBeCloseTo(local.position.y)
    expect(back.rotation).toBeCloseTo(local.rotation)
    expect(back.elevation).toBeCloseTo(local.elevation)
  })
})

describe('planToThree', () => {
  it('maps plan (x,y,elevation) cm to three (x,elev,z) meters and negates rotation', () => {
    const { position, rotationY } = planToThree({
      position: { x: 250, y: 120 },
      rotation: 90,
      elevation: 75,
    })
    expect(position).toEqual([2.5, 0.75, 1.2])
    expect(rotationY).toBeCloseTo(-Math.PI / 2)
  })

  it('round-trips a Three.js ground point back to plan centimetres', () => {
    expect(threeToPlan(2.5, 1.2)).toEqual({ x: 250, y: 120 })
  })
})

describe('normalizeDeg', () => {
  it('wraps into [0,360)', () => {
    expect(normalizeDeg(-90)).toBe(270)
    expect(normalizeDeg(720)).toBe(0)
    expect(normalizeDeg(45)).toBe(45)
  })
})

/**
 * Round 4 item 4. The mirror is ONE optional bit on the parent, and everything a
 * mirrored table's chairs, covers and design pieces do follows from these two
 * functions — so this is where the rule is pinned rather than in a renderer.
 */
describe('composeTransform / relativeTransform with a mirrored parent', () => {
  const local = { position: { x: 10, y: 4 }, rotation: 15, elevation: 5 }

  it('flips the child BEFORE the parent turns, and negates the angle inside it', () => {
    const parent = { position: { x: 100, y: 50 }, rotation: 0, elevation: 0, mirrored: true }
    const world = composeTransform(parent, local)
    expect(world.position.x).toBeCloseTo(90) // 100 + (-10)
    expect(world.position.y).toBeCloseTo(54) // y is untouched by a reflection in x
    // R · Rot(ρ) · R⁻¹ = Rot(−ρ)
    expect(world.rotation).toBeCloseTo(-15)
  })

  it('still inverts exactly, with the flag on the parent', () => {
    const parent = { position: { x: 100, y: 50 }, rotation: 37, elevation: 2, mirrored: true }
    const back = relativeTransform(parent, composeTransform(parent, local))
    expect(back.position.x).toBeCloseTo(local.position.x)
    expect(back.position.y).toBeCloseTo(local.position.y)
    expect(back.rotation).toBeCloseTo(local.rotation)
    expect(back.elevation).toBeCloseTo(local.elevation)
  })

  it('XORs the flag: two reflections are none', () => {
    const parent = { position: { x: 0, y: 0 }, rotation: 0, elevation: 0, mirrored: true }
    const mirroredChild = { ...local, mirrored: true }
    expect(composeTransform(parent, mirroredChild).mirrored).toBeUndefined()
    expect(composeTransform(parent, local).mirrored).toBe(true)
    expect(composeTransform({ ...parent, mirrored: undefined }, mirroredChild).mirrored).toBe(true)
  })

  it('adds NOTHING when neither side is mirrored — the pre-round-4 output, byte for byte', () => {
    const parent = { position: { x: 100, y: 50 }, rotation: 90, elevation: 0 }
    expect(composeTransform(parent, local)).toEqual({
      position: { x: 96, y: 60 },
      rotation: 105,
      elevation: 5,
    })
  })
})
