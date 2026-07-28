import { describe, expect, it } from 'vitest'
import { beamGrid, clampHang, cordLength, hangRange, MAX_DROP_FROM_CEILING, snapToBeam } from './beams'
import { getVenuePack } from '../venuePacks'

const resort = getVenuePack('resort')!
const beams = resort.ceilingBeams!

/**
 * These used to assert that both axes snap at once, i.e. that a fixture can only
 * ever sit on one of the 36 crossings of the resort grid. That IS what the code
 * did, and it is what the user reported as "I cannot move the chandeliers in 3D,
 * they look locked" (source doc §32). Sliding along the nearest beam is the fix,
 * so the assertions below move with it: one axis snaps, the other stays where the
 * pointer put it. What is NOT weakened is the invariant underneath — every result
 * still sits on a beam (source doc §12), which the sweep in beamCrossings.test.ts
 * checks over the whole hall.
 */
describe('snapToBeam', () => {
  // axis:'y' beams sit at x [578…3821]; axis:'x' beams sit at y [190…1270]
  it('snaps the nearer family only, so the fixture slides along that beam', () => {
    // nearest x line is 21 away, nearest y line is 70 — it rides the x beam
    expect(snapToBeam({ x: 3800, y: 1200 }, beams)).toEqual({ x: 3821, y: 1200 })
    // and the other way round: 10 from a y line, 111 from an x one
    expect(snapToBeam({ x: 1500, y: 560 }, beams)).toEqual({ x: 1500, y: 550 })
  })

  it('still lands on a crossing where the two snap regions meet', () => {
    expect(snapToBeam({ x: 1000, y: 200 }, beams)).toEqual({ x: 988, y: 190 })
    // 20 cm off one family and 30 off the other — both inside CROSSING_SNAP (35)
    expect(snapToBeam({ x: 3841, y: 1240 }, beams)).toEqual({ x: 3821, y: 1270 })
  })

  it('reads `axis` as the run direction, not as the constrained coordinate', () => {
    // 550 is a valid Y line and 578 a valid X one; swapping the families would
    // return {x:550,y:578} for a point near the corner of the grid
    expect(snapToBeam({ x: 560, y: 560 }, beams)).toEqual({ x: 578, y: 550 })
  })

  it('clamps to the outermost beam outside the grid', () => {
    expect(snapToBeam({ x: -900, y: 9000 }, beams)).toEqual({ x: 578, y: 1270 })
  })

  it('does not let a fixture slide off the end of the beam it rides', () => {
    // on the last x beam, dragged past the last crossing: the free axis is held
    // to the run of the truss, which the other family's outermost members bound
    expect(snapToBeam({ x: 3800, y: -500 }, beams)).toEqual({ x: 3821, y: 190 })
    expect(snapToBeam({ x: 3800, y: 2400 }, beams)).toEqual({ x: 3821, y: 1270 })
  })

  it('is idempotent — clampToVenue re-snaps an already snapped position', () => {
    for (const p of [
      { x: 3800, y: 1200 },
      { x: 1500, y: 560 },
      { x: 1000, y: 200 },
      { x: -900, y: 9000 },
    ]) {
      const once = snapToBeam(p, beams)
      expect(snapToBeam(once, beams)).toEqual(once)
    }
  })

  it('leaves an axis alone when its family is missing', () => {
    const onlyY = [{ axis: 'y' as const, positions: [100, 200], height: 900 }]
    expect(snapToBeam({ x: 260, y: 777 }, onlyY)).toEqual({ x: 200, y: 777 })
    expect(snapToBeam({ x: 260, y: 777 }, [])).toEqual({ x: 260, y: 777 })
  })

  /**
   * Where a fixture may end up is the TRUSS rectangle, which is smaller than the
   * hall: the resort measures 6051 × 2544 but its truss only spans x 578…3821 and
   * y 190…1270. The reception deck (x from 4432) has no beams over it, so nothing
   * can hang there — that was true of the crossing snap too, and sliding must not
   * quietly change it in either direction.
   */
  it('cannot put a fixture where the truss is not, deck included', () => {
    const xs = beams.find((b) => b.axis === 'y')!.positions
    const ys = beams.find((b) => b.axis === 'x')!.positions
    const deck = [
      { x: 6000, y: 1500 },
      { x: 5000, y: 900 },
      { x: 4432, y: 1200 },
      { x: resort.size.width, y: resort.size.depth },
    ]
    for (const p of deck) {
      const snapped = snapToBeam(p, beams)
      expect(snapped.x).toBeLessThanOrEqual(Math.max(...xs))
      expect(snapped.y).toBeLessThanOrEqual(Math.max(...ys))
      // and it lands exactly where the old crossing snap put it: the nearest of each
      expect(snapped).toEqual({
        x: xs.reduce((a, b) => (Math.abs(b - p.x) < Math.abs(a - p.x) ? b : a)),
        y: ys.reduce((a, b) => (Math.abs(b - p.y) < Math.abs(a - p.y) ? b : a)),
      })
    }
  })
})

describe('beamGrid', () => {
  it('uses the pack grid when the model provided one', () => {
    expect(beamGrid(resort, resort.size)).toBe(beams)
  })

  it('falls back to an even 250 cm lattice, inset from the walls', () => {
    const grid = beamGrid(undefined, { width: 1000, depth: 600 })
    const xs = grid.find((g) => g.axis === 'y')!.positions
    const ys = grid.find((g) => g.axis === 'x')!.positions
    expect(xs).toEqual([125, 375, 625, 875])
    expect(ys).toEqual([175, 425])
    // symmetric: the inset at both ends is the same
    expect(xs[0]).toBeCloseTo(1000 - xs[xs.length - 1])
    expect(ys[0]).toBeCloseTo(600 - ys[ys.length - 1])
  })

  it('gives a tiny room one central line rather than none', () => {
    expect(beamGrid(undefined, { width: 200, depth: 200 })[0].positions).toEqual([100])
  })
})

describe('hangRange', () => {
  // A plain 90 cm drop, deliberately NOT read from the catalog: these cases pin
  // the arithmetic of hangRange itself, so the height has to stay put while
  // catalogued sizes move. (It WAS lamp.chandelier-diamond's height until the
  // ×2.5 of corrections document §8 took that entry to 225.)
  const chandelier = 90

  it('runs from the truss line down to 6.5 m below the CEILING', () => {
    // top starts at hangHeight 895 − 90 = 805. The floor of the range is measured
    // off the roof, not the truss: 1160 − 650 − 90 = 420.
    expect(hangRange(resort, resort.wallHeight, chandelier)).toEqual({ min: 420, max: 805 })
    // the truss is already 265 cm below the roof, so 385 of the 6.5 m is left
    const trussBelowRoof = resort.wallHeight - (resort.hangHeight ?? resort.wallHeight)
    expect(805 - 420).toBe(MAX_DROP_FROM_CEILING - trussBelowRoof)
  })

  it('gives the full drop when the anchor IS the ceiling', () => {
    // no truss: the anchor is wallHeight, so the whole 6.5 m is available
    expect(hangRange(undefined, 1160, 90)).toEqual({ min: 420, max: 1070 })
  })

  it('never inverts when the ceiling limit sits above the anchor', () => {
    // a low room: wallHeight 350 puts the limit below zero, so min floors at 0
    expect(hangRange(undefined, 350, 50)).toEqual({ min: 0, max: 300 })
  })

  it('clamps both ends', () => {
    expect(clampHang(resort, resort.wallHeight, chandelier, 9999)).toBe(805)
    expect(clampHang(resort, resort.wallHeight, chandelier, 0)).toBe(420)
    expect(clampHang(resort, resort.wallHeight, chandelier, 700)).toBe(700)
  })
})

describe('cordLength', () => {
  it('is zero at the seeded elevation and grows as the fixture drops', () => {
    expect(cordLength(resort, resort.wallHeight, 90, 805)).toBe(0)
    expect(cordLength(resort, resort.wallHeight, 90, 405)).toBe(400)
  })

  // It stops at the hang anchor and not at the beam geometry 15 cm above it. That
  // is a deliberate no-op, not an oversight: extending it there was built,
  // photographed from six angles and reverted, because the beam hides its own
  // underside (handoff/FOUND-05-A2.md §1).
  it('measures to the hang anchor, not to the beam above it', () => {
    const beamAboveAnchor = Math.max(...beams.map((b) => b.height)) - resort.hangHeight!
    expect(beamAboveAnchor).toBeGreaterThan(0)
    expect(cordLength(resort, resort.wallHeight, 90, resort.hangHeight! - 90)).toBe(0)
  })

  it('never goes negative if a fixture sits above the anchor', () => {
    expect(cordLength(resort, resort.wallHeight, 90, 900)).toBe(0)
  })
})
