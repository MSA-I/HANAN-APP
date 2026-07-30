/**
 * The rotation rule (round 4).
 *
 * The first describe is the important one: free rotation is the DEFAULT and
 * `Shift` opts into the snap, so `step === 0` being an exact passthrough IS the
 * user's decision. Anything that quietly re-introduces a normalisation there —
 * "it's only a ten-trillionth" — fails here rather than in a drag six weeks on.
 *
 * The snap step is read from `ROTATION_SNAP_DEG`, never restated: rounds 2 and 3
 * were both burned by a test that froze a constant and stayed green while the
 * constant moved underneath it.
 */
import { describe, expect, it } from 'vitest'
import { normalizeDeg } from './space'
import { ROTATION_SNAP_DEG, rotationSnapsDeg, snapAngle } from './rotation'

const STEP = ROTATION_SNAP_DEG

describe('no snap is the default', () => {
  it('hands a fractional angle straight back, to the last bit', () => {
    // measured: normalizeDeg(37.3) is 37.30000000000001 and normalizeDeg(0.1) is
    // 0.10000000000002274, so "passthrough" has to mean identity, not "close"
    for (const deg of [0, 0.1, 37.3, 45.5, 123.456, 200.05, 359.999]) {
      expect(snapAngle(deg, 0)).toBe(deg)
    }
  })

  it('is idempotent and never drifts over a gesture', () => {
    let angle = 37.3
    for (let frame = 0; frame < 100; frame++) angle = snapAngle(angle, 0)
    expect(angle).toBe(37.3)
  })

  /** Shift is the only thing that arms the snap, so anything not-a-step is off. */
  it('treats a negative, a NaN and an Infinity step as no snap', () => {
    for (const step of [0, -1, -STEP, NaN, Infinity]) expect(snapAngle(37.3, step)).toBe(37.3)
  })

  it('still wraps an out-of-range angle', () => {
    expect(snapAngle(370, 0)).toBe(10)
    expect(snapAngle(-90, 0)).toBe(270)
  })
})

describe('snapping to the chosen step', () => {
  it('rounds to the nearest position', () => {
    expect(snapAngle(37, STEP)).toBe(45)
    expect(snapAngle(20, STEP)).toBe(0)
    expect(snapAngle(70, STEP)).toBe(90)
  })

  /**
   * The one that has bitten this repo before: a full turn is 0, not 360. An
   * unnormalised 360 prints as "360°", compares unequal to the 0 it means, and
   * would be normalised away by the next thing that touched it — so the bug
   * surfaces one interaction later than it was caused.
   */
  it('never returns 360', () => {
    expect(snapAngle(358, STEP)).toBe(0)
    expect(snapAngle(359.999, STEP)).toBe(0)
    expect(snapAngle(360, STEP)).toBe(0)
    for (let deg = 0; deg < 360; deg += 0.5) expect(snapAngle(deg, STEP)).toBeLessThan(360)
  })

  it('breaks an exact tie clockwise, deterministically', () => {
    const half = STEP / 2
    expect(snapAngle(half, STEP)).toBe(STEP)
    expect(snapAngle(STEP + half, STEP)).toBe(2 * STEP)
    // the wrap runs first, so a negative tie is the same question asked from the
    // other side and gets the same answer rather than a sign-dependent one
    expect(snapAngle(-half, STEP)).toBe(0)
    expect(snapAngle(-half, STEP)).toBe(snapAngle(360 - half, STEP))
  })

  it('handles negatives and inputs past a full turn', () => {
    expect(snapAngle(-37, STEP)).toBe(315)
    expect(snapAngle(-100, STEP)).toBe(270)
    expect(snapAngle(397, STEP)).toBe(45)
    expect(snapAngle(757, STEP)).toBe(45)
    expect(snapAngle(-720 + 37, STEP)).toBe(45)
  })

  /** The answer is a property of the angle, not of how it was written down. */
  it('gives the same answer for any spelling of the same angle', () => {
    for (const deg of [0, 12, 37, 180, 200.05, 358]) {
      for (const turns of [-2, -1, 1, 3]) {
        expect(snapAngle(deg + 360 * turns, STEP)).toBe(snapAngle(deg, STEP))
      }
    }
  })

  it('is idempotent', () => {
    for (let deg = -400; deg < 760; deg += 7.3) {
      const once = snapAngle(deg, STEP)
      expect(snapAngle(once, STEP)).toBe(once)
    }
  })

  /** A NaN rotation renders as nothing in BOTH Konva and three.js — it must not escape. */
  it('guards NaN and Infinity', () => {
    for (const deg of [NaN, Infinity, -Infinity]) {
      expect(snapAngle(deg, STEP)).toBe(0)
      expect(snapAngle(deg, 0)).toBe(0)
    }
  })

  it('lands only on angles that survive normalizeDeg unchanged', () => {
    for (let deg = -400; deg < 760; deg += 11) {
      const snapped = snapAngle(deg, STEP)
      expect(normalizeDeg(snapped)).toBe(snapped)
    }
  })
})

describe('the positions a ring draws', () => {
  it('is every multiple of the step below a full turn', () => {
    expect(rotationSnapsDeg(STEP)).toEqual([0, 45, 90, 135, 180, 225, 270, 315])
    expect(rotationSnapsDeg(90)).toEqual([0, 90, 180, 270])
  })

  it('is empty for free rotation, so a ring maps over it and draws nothing', () => {
    expect(rotationSnapsDeg(0)).toEqual([])
    expect(rotationSnapsDeg(-45)).toEqual([])
    expect(rotationSnapsDeg(NaN)).toEqual([])
  })

  /** Ticks the table can never stop on would be a lie drawn on the canvas. */
  it('lists exactly the angles snapAngle can produce', () => {
    for (const step of [STEP, 90, 30, 50]) {
      const ticks = rotationSnapsDeg(step)
      const reachable = new Set<number>()
      for (let deg = 0; deg < 360; deg += 0.25) reachable.add(snapAngle(deg, step))
      expect([...reachable].sort((a, b) => a - b)).toEqual(ticks)
    }
  })

  it('stays inside [0, 360) for a step that does not divide a turn', () => {
    const ticks = rotationSnapsDeg(7)
    expect(ticks[0]).toBe(0)
    expect(Math.max(...ticks)).toBeLessThan(360)
  })
})
