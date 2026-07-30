/**
 * The rotation ring.
 *
 * Two things are worth more than the rest here:
 *
 *  - The band traces the table. The knights table is 480 × 120, and every naive
 *    ring is a circle: sized off the long side it is ⌀990 of empty band standing
 *    4 m clear of the short ends, and even a proper circumscribing circle stands
 *    1.87 m clear of the long sides. Both cover the neighbouring furniture and
 *    neither says which table it belongs to. The tests below measure the
 *    clearance on both axes rather than checking a `kind`.
 *  - `planAngleBetween` is clockwise-positive because plan space is y-DOWN. The
 *    wrong sign does not throw and does not look broken in a screenshot — the
 *    table simply turns against the hand — so all four quadrants and all four
 *    axes are pinned.
 *
 * Table dimensions come from the CATALOG. The knights table has been re-measured
 * once already; a copied 480 would keep this file green while it stopped testing
 * the table it names.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import type { Outline } from '../catalog/types'
import { ROTATION_SNAP_DEG, snapAngle } from '../rotation'
import {
  GRAZING_RAY_DIR_Y,
  MAX_HIT_RADIUS_FACTOR,
  isUsableRotationHit,
  planAngleBetween,
  rotateRingRadius,
  rotateRingShape,
  rotationFromDrag,
} from './rotateHandle'

const GAP = 18
const BAND = 12
const ORIGIN = { x: 0, y: 0 }

const outlineOf = (catalogId: string): Outline => {
  const entry = getCatalogEntry(catalogId)
  return entry.footprint(entry.defaultSize).outline
}

const asRect = (catalogId: string) => {
  const outline = outlineOf(catalogId)
  if (outline.kind !== 'rect') throw new Error(`${catalogId} is not rectangular`)
  return outline
}

const asCircle = (catalogId: string) => {
  const outline = outlineOf(catalogId)
  if (outline.kind !== 'circle') throw new Error(`${catalogId} is not round`)
  return outline
}

describe('the band round a rectangular table', () => {
  const table = asRect('table.knights-480')
  const ring = rotateRingShape(table, GAP, BAND)

  it('is a rounded rect built on the proportions of the table itself', () => {
    expect(table.w).toBeGreaterThan(3 * table.h) // the premise, read off the catalog
    expect(ring).toEqual({
      kind: 'rect',
      w: table.w + 2 * GAP + BAND,
      h: table.h + 2 * GAP + BAND,
      corner: GAP + BAND / 2,
      band: BAND,
    })
  })

  /** The claim, measured: nowhere does the band stand further off than gap + band. */
  it('hugs the footprint on both axes, long side and short', () => {
    if (ring.kind !== 'rect') throw new Error('expected a rect band')
    const outerX = ring.w / 2 + ring.band / 2
    const outerY = ring.h / 2 + ring.band / 2
    expect(outerX - table.w / 2).toBeCloseTo(GAP + BAND, 9)
    expect(outerY - table.h / 2).toBeCloseTo(GAP + BAND, 9)
  })

  it('leaves exactly `gap` of clear floor before the band starts', () => {
    if (ring.kind !== 'rect') throw new Error('expected a rect band')
    expect(ring.w / 2 - ring.band / 2 - table.w / 2).toBeCloseTo(GAP, 9)
    expect(ring.h / 2 - ring.band / 2 - table.h / 2).toBeCloseTo(GAP, 9)
  })

  it('is not the floating circle either naive version would have drawn', () => {
    if (ring.kind !== 'rect') throw new Error('expected a rect band')
    // sized off the long side, the way ⌀990 gets reached
    const offTheLongSide = 2 * (table.w + GAP)
    // and even a proper circumscribing circle stands this far off the long sides
    const circumscribed = Math.hypot(table.w / 2, table.h / 2)
    expect(offTheLongSide).toBeGreaterThan(900)
    expect(circumscribed - table.h / 2).toBeGreaterThan(150)
    // what it actually does, on the same axis
    expect(ring.h / 2 + ring.band / 2 - table.h / 2).toBeCloseTo(GAP + BAND, 9)
  })

  it('gives the inner corner exactly the gap as its radius', () => {
    if (ring.kind !== 'rect') throw new Error('expected a rect band')
    expect(ring.corner - ring.band / 2).toBeCloseTo(GAP, 9)
    expect(ring.corner + ring.band / 2).toBeCloseTo(GAP + BAND, 9)
    // a corner larger than the short half-side would not be drawable
    expect(ring.corner).toBeLessThanOrEqual(Math.min(ring.w, ring.h) / 2)
  })

  it('works for a square table too', () => {
    const square = asRect('table.square')
    const squareRing = rotateRingShape(square, GAP, BAND)
    if (squareRing.kind !== 'rect') throw new Error('expected a rect band')
    expect(squareRing.w).toBe(squareRing.h)
  })
})

describe('the band round a round table', () => {
  it('is an annulus sitting gap-clear of the edge', () => {
    const table = asCircle('table.round')
    expect(rotateRingShape(table, GAP, BAND)).toEqual({
      kind: 'circle',
      rInner: table.r + GAP,
      rOuter: table.r + GAP + BAND,
    })
  })

  /** The ⌀380's hole is inside the table; the hand goes round the outside. */
  it('traces the outer edge of a ring table and ignores its hole', () => {
    const ringTable = asCircle('table.round-large')
    expect(ringTable.rInner).toBeGreaterThan(0) // the premise, read off the catalog
    const band = rotateRingShape(ringTable, GAP, BAND)
    if (band.kind !== 'circle') throw new Error('expected a circular band')
    expect(band.rInner).toBe(ringTable.r + GAP)
    expect(band.rInner).toBeGreaterThan(ringTable.rInner!)
  })
})

describe('a nonsense gap or band', () => {
  it('degenerates to a zero-width band instead of an inverted one', () => {
    const table = asCircle('table.round')
    for (const bad of [-5, NaN, Infinity]) {
      const band = rotateRingShape(table, bad, bad)
      if (band.kind !== 'circle') throw new Error('expected a circular band')
      expect(band.rInner).toBe(table.r)
      expect(band.rOuter).toBe(table.r)
      expect(band.rOuter).toBeGreaterThanOrEqual(band.rInner)
    }
  })
})

describe('how far the ring reaches', () => {
  it('is the outer radius for a circle', () => {
    const table = asCircle('table.round')
    expect(rotateRingRadius(rotateRingShape(table, GAP, BAND))).toBe(table.r + GAP + BAND)
  })

  it('reaches the corners for a rect, and no further', () => {
    const table = asRect('table.knights-480')
    const ring = rotateRingShape(table, GAP, BAND)
    if (ring.kind !== 'rect') throw new Error('expected a rect band')
    const reach = rotateRingRadius(ring)
    expect(reach).toBeCloseTo(Math.hypot(ring.w / 2, ring.h / 2) + ring.band / 2, 9)
    expect(reach).toBeGreaterThan(table.w / 2)
    expect(reach).toBeLessThan(table.w / 2 + GAP + BAND + table.h)
  })
})

/**
 * Zero is straight UP (-y) and the angle grows CLOCKWISE, matching
 * `transform.rotation` exactly so a bearing can be assigned to a rotation with no
 * sign flip on the way.
 */
describe('the bearing from a table to a point', () => {
  it('puts zero straight up and a quarter turn to the right', () => {
    expect(planAngleBetween(ORIGIN, { x: 0, y: -100 })).toBe(0)
    expect(planAngleBetween(ORIGIN, { x: 100, y: 0 })).toBe(90)
    expect(planAngleBetween(ORIGIN, { x: 0, y: 100 })).toBe(180)
    expect(planAngleBetween(ORIGIN, { x: -100, y: 0 })).toBe(270)
  })

  it('is right in all four quadrants', () => {
    expect(planAngleBetween(ORIGIN, { x: 10, y: -10 })).toBeCloseTo(45, 9) // up-right
    expect(planAngleBetween(ORIGIN, { x: 10, y: 10 })).toBeCloseTo(135, 9) // down-right
    expect(planAngleBetween(ORIGIN, { x: -10, y: 10 })).toBeCloseTo(225, 9) // down-left
    expect(planAngleBetween(ORIGIN, { x: -10, y: -10 })).toBeCloseTo(315, 9) // up-left
  })

  /** The sign check that matters: going clockwise on screen must INCREASE it. */
  it('increases as the point travels clockwise', () => {
    const centre = { x: 1000, y: 700 }
    const seen: number[] = []
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180
      // deg° clockwise from straight up, in a y-down plan
      seen.push(planAngleBetween(centre, {
        x: centre.x + 200 * Math.sin(rad),
        y: centre.y - 200 * Math.cos(rad),
      }))
    }
    for (let i = 0; i < seen.length; i++) expect(seen[i]).toBeCloseTo(i * 15, 6)
  })

  it('does not care how far away the point is, only which way', () => {
    for (const r of [0.5, 10, 5000]) {
      expect(planAngleBetween(ORIGIN, { x: r, y: -r })).toBeCloseTo(45, 9)
    }
  })

  it('is offset-independent', () => {
    expect(planAngleBetween({ x: 700, y: -300 }, { x: 700, y: -400 })).toBe(0)
    expect(planAngleBetween({ x: 700, y: -300 }, { x: 800, y: -300 })).toBe(90)
  })

  /** atan2(0, -0) is π — a click dead centre would half-turn the table. */
  it('returns 0 for a point exactly on the centre', () => {
    expect(planAngleBetween(ORIGIN, ORIGIN)).toBe(0)
    expect(planAngleBetween({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })

  it('always lands in [0, 360)', () => {
    for (let i = 0; i < 720; i++) {
      const rad = (i * Math.PI) / 360
      const angle = planAngleBetween(ORIGIN, { x: Math.sin(rad) * 30, y: Math.cos(rad) * 30 })
      expect(angle).toBeGreaterThanOrEqual(0)
      expect(angle).toBeLessThan(360)
    }
  })
})

describe('turning a table by its ring', () => {
  const drag = (startRotation: number, startAngle: number, currentAngle: number, snapDeg = 0) =>
    rotationFromDrag({ startRotation, startAngle, currentAngle, snapDeg })

  /** Grab the ring anywhere: the table turns from where it was, it does not jump. */
  it('follows the swept angle, not the absolute bearing of the pointer', () => {
    expect(drag(90, 0, 10)).toBe(100)
    expect(drag(90, 200, 210)).toBe(100) // same 10° sweep, grabbed elsewhere
    expect(drag(0, 137, 137)).toBe(0) // grabbing without moving turns nothing
  })

  it('turns both ways and wraps at the seam', () => {
    expect(drag(10, 100, 70)).toBe(340) // 30° anticlockwise past zero
    expect(drag(350, 0, 20)).toBe(10) // 20° clockwise past zero
    expect(drag(0, 0, 720 + 45)).toBe(45)
  })

  it('lands on absolute snap positions, not on the angle it started from', () => {
    const step = ROTATION_SNAP_DEG
    expect(drag(7, 0, 30, step)).toBe(45) // 7 + 30 = 37 → 45, not 7 + 45
    expect(drag(0, 0, 20, step)).toBe(0)
    expect(drag(0, 0, 358, step)).toBe(0) // never 360
  })

  it('delegates the snap rather than reimplementing it', () => {
    for (const step of [0, ROTATION_SNAP_DEG, 90]) {
      for (const swept of [-137, -1, 0, 22.5, 37.3, 400]) {
        expect(drag(23.5, 0, swept, step)).toBe(snapAngle(23.5 + swept, step))
      }
    }
  })

  it('leaves a free rotation exactly where the hand put it', () => {
    expect(drag(0, 0, 37.3)).toBe(37.3)
  })
})

describe('which pointer hits may turn a table', () => {
  const R = 250
  const near = { x: 0, y: -R }

  it('accepts an ordinary hit from a sane camera', () => {
    expect(isUsableRotationHit(ORIGIN, near, R, 0.8)).toBe(true)
    expect(isUsableRotationHit(ORIGIN, near, R, -0.8)).toBe(true)
  })

  /** The plan has no ray; it says "straight down" and only the distance bites. */
  it('accepts the 2D plan, which passes a vertical ray', () => {
    expect(isUsableRotationHit(ORIGIN, near, R, 1)).toBe(true)
  })

  it('rejects a grazing ray, at the stated threshold', () => {
    expect(isUsableRotationHit(ORIGIN, near, R, GRAZING_RAY_DIR_Y)).toBe(true)
    expect(isUsableRotationHit(ORIGIN, near, R, -GRAZING_RAY_DIR_Y)).toBe(true)
    expect(isUsableRotationHit(ORIGIN, near, R, GRAZING_RAY_DIR_Y - 1e-9)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, near, R, 0)).toBe(false)
  })

  it('rejects a hit that landed on the far side of the hall', () => {
    const edge = MAX_HIT_RADIUS_FACTOR * R
    expect(isUsableRotationHit(ORIGIN, { x: edge, y: 0 }, R, 1)).toBe(true)
    expect(isUsableRotationHit(ORIGIN, { x: edge + 0.001, y: 0 }, R, 1)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, { x: 1e9, y: 1e9 }, R, 1)).toBe(false)
  })

  it('measures the distance from the table, not from the origin', () => {
    // a small ring, so 30 radii is 15 m and the far corner of a hall is outside it
    const small = 50
    const centre = { x: 4000, y: 3000 }
    expect(isUsableRotationHit(centre, { x: 4000, y: 3000 - small }, small, 1)).toBe(true)
    expect(isUsableRotationHit(centre, { x: 0, y: 0 }, small, 1)).toBe(false)
    // the very same point, judged for a table that is standing on it
    expect(isUsableRotationHit(ORIGIN, { x: 0, y: 0 }, small, 1)).toBe(true)
  })

  it('refuses anything non-finite instead of turning the table by NaN', () => {
    expect(isUsableRotationHit(ORIGIN, near, R, NaN)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, near, NaN, 1)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, { x: NaN, y: 0 }, R, 1)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, { x: Infinity, y: 0 }, R, 1)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, near, 0, 1)).toBe(false)
    expect(isUsableRotationHit(ORIGIN, near, -R, 1)).toBe(false)
  })
})
