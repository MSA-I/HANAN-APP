import { describe, expect, it } from 'vitest'
import {
  coverageFrom,
  diffCount,
  isVisibleEnough,
  MIN_COVERAGE_FRACTION,
  toFraction,
} from './coverage'

/** `n` RGBA pixels, every channel `v`. */
const solid = (n: number, v: number): Uint8Array => new Uint8Array(n * 4).fill(v)

describe('diffCount', () => {
  it('counts nothing when the two frames are identical', () => {
    expect(diffCount(solid(100, 40), solid(100, 40))).toBe(0)
  })

  it('counts every pixel when the whole frame changed', () => {
    expect(diffCount(solid(100, 0), solid(100, 255))).toBe(100)
  })

  it('counts one pixel when one pixel changed', () => {
    const a = solid(100, 10)
    const b = solid(100, 10)
    b[4 * 7] = 200
    expect(diffCount(a, b)).toBe(1)
  })

  it('counts a pixel that moved on only one channel', () => {
    const a = solid(4, 10)
    for (const channel of [0, 1, 2]) {
      const b = solid(4, 10)
      b[channel] = 200
      expect(diffCount(a, b), `channel ${channel}`).toBe(1)
    }
  })

  /**
   * The threshold is not tuning for its own sake. Hiding an object also removes
   * what it gave the ContactShadows pass and the environment's ambient
   * occlusion, so its NEIGHBOURS move by a value or two. Counting those would
   * report an object as covering the ground around it.
   */
  it('ignores drift below the threshold and counts it above', () => {
    const a = solid(10, 100)
    const justUnder = solid(10, 100)
    justUnder.fill(106) // +6, equal to the default threshold, so not "> threshold"
    expect(diffCount(a, justUnder)).toBe(0)

    const justOver = solid(10, 100)
    justOver.fill(107)
    expect(diffCount(a, justOver)).toBe(10)
  })

  it('takes the threshold as an argument', () => {
    const a = solid(10, 100)
    const b = solid(10, 120)
    expect(diffCount(a, b, 50)).toBe(0)
    expect(diffCount(a, b, 5)).toBe(10)
  })

  it('ignores alpha, which is 255 everywhere on an opaque canvas', () => {
    const a = solid(4, 30)
    const b = solid(4, 30)
    for (let i = 3; i < b.length; i += 4) b[i] = 0
    expect(diffCount(a, b)).toBe(0)
  })

  it('reads only the length the two frames share, rather than overrunning', () => {
    expect(diffCount(solid(4, 0), solid(10, 255))).toBe(4)
    expect(diffCount(solid(10, 0), solid(4, 255))).toBe(4)
    expect(diffCount(new Uint8Array(0), solid(4, 255))).toBe(0)
  })
})

describe('toFraction', () => {
  it('divides, and clamps to 0..1', () => {
    expect(toFraction(50, 200)).toBe(0.25)
    expect(toFraction(0, 200)).toBe(0)
    expect(toFraction(400, 200)).toBe(1)
    expect(toFraction(-5, 200)).toBe(0)
  })

  it('reads a zero or nonsense frame size as zero rather than as Infinity', () => {
    expect(toFraction(50, 0)).toBe(0)
    expect(toFraction(50, -1)).toBe(0)
    expect(toFraction(Number.NaN, 200)).toBe(0)
    expect(toFraction(50, Number.NaN)).toBe(0)
  })
})

describe('coverageFrom', () => {
  it('turns a pixel count per id into a fraction per id', () => {
    expect(coverageFrom({ a: 50, b: 0, c: 200 }, 200)).toEqual({ a: 0.25, b: 0, c: 1 })
  })

  it('has nothing to say about a scene with nothing in it', () => {
    expect(coverageFrom({}, 98304)).toEqual({})
  })

  it('resolves a real frame size to a real fraction', () => {
    // the measuring pass is 384x256
    expect(coverageFrom({ a: 9830 }, 384 * 256).a).toBeCloseTo(0.1, 5)
  })
})

describe('the threshold', () => {
  it('is inclusive — a product exactly on it keeps its slot', () => {
    expect(isVisibleEnough(MIN_COVERAGE_FRACTION)).toBe(true)
    expect(isVisibleEnough(MIN_COVERAGE_FRACTION * 1.0001)).toBe(true)
    expect(isVisibleEnough(MIN_COVERAGE_FRACTION * 0.999)).toBe(false)
  })

  it('treats an unmeasured object as invisible', () => {
    // reached only when a coverage map EXISTS and omits the id, which means the
    // oracle looked and found nothing — not "nobody looked"
    expect(isVisibleEnough(undefined)).toBe(false)
    expect(isVisibleEnough(0)).toBe(false)
  })

  it('stays a fraction of a frame, not a pixel count', () => {
    expect(MIN_COVERAGE_FRACTION).toBeGreaterThan(0)
    expect(MIN_COVERAGE_FRACTION).toBeLessThan(0.01)
  })

  /**
   * The measuring pass is one sixteenth of the capture's area, so the threshold
   * has to still mean something there. Below ~10 pixels it would stop being able
   * to tell a small visible object from readback noise.
   */
  it('is still more than a few pixels at the resolution it is measured on', () => {
    expect(MIN_COVERAGE_FRACTION * 384 * 256).toBeGreaterThanOrEqual(5)
  })
})
