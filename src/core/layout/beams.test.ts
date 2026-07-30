import { describe, expect, it } from 'vitest'
import { beamGrid, clampHang, cordLength, hangRange, MAX_DROP_FROM_CEILING, snapToBeam } from './beams'
import { getVenuePack } from '../venuePacks'

const resort = getVenuePack('resort')!
const beams = resort.ceilingBeams!

/**
 * Read the grid off the catalog — `axis` is the RUN direction, so the 'y' family
 * is the set of x values and vice versa. These used to be written out as literals
 * (578, 988, 3821 …), which is why the 2026-07-29 re-extraction broke five
 * assertions that were testing nothing but the old numbers: the y family moved
 * 11-22 cm onto the real tubes and gained the two beams the hand transcription
 * had never seen (Plans/R3/handoff/01-beams.md). Probe points are offsets from
 * these, so the next re-measure moves the test with the model instead of against
 * it (AGENT-BRIEF §1.7).
 */
const XS = beams.find((b) => b.axis === 'y')!.positions
const YS = beams.find((b) => b.axis === 'x')!.positions
/** how far each family's beams RUN — the bound on the free coordinate */
const RUN_Y = beams.find((b) => b.axis === 'y')!.span!
const RUN_X = beams.find((b) => b.axis === 'x')!.span!
/** a point squarely between two members, i.e. as far from that family as it gets */
const midX = (i: number) => (XS[i] + XS[i + 1]) / 2
const midY = (i: number) => (YS[i] + YS[i + 1]) / 2
const lastX = XS[XS.length - 1]
const lastY = YS[YS.length - 1]

/**
 * These used to assert that both axes snap at once, i.e. that a fixture can only
 * ever sit on one of the crossings of the resort grid — 36 of them then, 33 after
 * the 2026-07-29 re-extraction (11 × 3). That IS what the code
 * did, and it is what the user reported as "I cannot move the chandeliers in 3D,
 * they look locked" (source doc §32). Sliding along the nearest beam is the fix,
 * so the assertions below move with it: one axis snaps, the other stays where the
 * pointer put it. What is NOT weakened is the invariant underneath — every result
 * still sits on a beam (source doc §12), which the sweep in beamCrossings.test.ts
 * checks over the whole hall.
 */
describe('snapToBeam', () => {
  it('snaps the nearer family only, so the fixture slides along that beam', () => {
    // 8 cm off an x line and half a bay from any y line — it rides the x beam
    // and keeps the y the pointer gave it
    expect(snapToBeam({ x: XS[8] + 8, y: midY(0) }, beams)).toEqual({ x: XS[8], y: midY(0) })
    // and the other way round
    expect(snapToBeam({ x: midX(1), y: YS[1] + 10 }, beams)).toEqual({ x: midX(1), y: YS[1] })
  })

  it('still lands on a crossing where the two snap regions meet', () => {
    // 32 cm off one family and 10 off the other — both inside CROSSING_SNAP (35)
    expect(snapToBeam({ x: XS[2] + 32, y: YS[0] + 10 }, beams)).toEqual({ x: XS[2], y: YS[0] })
    // 20 and 30, approached from the other side of each member. The far member is
    // `lastY`, not YS[3]: the x family went from four rows to three on 2026-07-29,
    // and a frozen index is the same mistake as a frozen number (AGENT-BRIEF §1.7).
    expect(snapToBeam({ x: XS[9] + 20, y: lastY - 30 }, beams)).toEqual({ x: XS[9], y: lastY })
  })

  it('reads `axis` as the run direction, not as the constrained coordinate', () => {
    // XS[1] and YS[1] are different numbers, so swapping the families would show:
    // this would come back as {x: YS[1], y: XS[1]} for a point near both
    expect(snapToBeam({ x: XS[1] + 5, y: YS[1] + 10 }, beams)).toEqual({ x: XS[1], y: YS[1] })
    expect(XS[1]).not.toBe(YS[1])
  })

  it('clamps to the outermost beam outside the grid, and to the END of its run', () => {
    // the nearest beam is the first tube; the free axis stops where the steel does
    expect(snapToBeam({ x: -900, y: 9000 }, beams)).toEqual({ x: XS[0], y: RUN_Y[1] })
  })

  /**
   * ⚠ This case used to assert the OPPOSITE of what it now asserts, and the change
   * is the whole of A4.1(a). The free coordinate was clamped to the outermost
   * members of the other family, so a fixture on the last tube could not pass
   * y = 1306 — it froze there while the pointer carried on into the southern half
   * of a 2544-deep hall, which is what "the ghost does not follow the mouse" meant.
   * The invariant that survives is the one about the STEEL: a fixture may not slide
   * off the end of the beam it rides, and the end is the family's declared `span`.
   */
  it('runs the full length of the beam it rides, and stops at its ends', () => {
    // past the north end of the tubes → held at the start of the run
    expect(snapToBeam({ x: lastX - 3, y: -500 }, beams)).toEqual({ x: lastX, y: RUN_Y[0] })
    // and 2400 is now REACHABLE, where the old rectangle stopped at YS[2] = 1306
    expect(snapToBeam({ x: lastX - 3, y: 2400 }, beams)).toEqual({ x: lastX, y: 2400 })
    expect(2400).toBeGreaterThan(lastY)
    // past the south end of the tubes → held again, 13 cm short of the wall,
    // because that is where the modelled steel stops (handoff/01-beams.md §5)
    expect(snapToBeam({ x: lastX - 3, y: 9999 }, beams)).toEqual({ x: lastX, y: RUN_Y[1] })
    expect(RUN_Y[1]).toBeLessThan(resort.size.depth)
    // the same the other way: riding a cross-run, x sweeps the roofed hall.
    // `midX` and not a round number — within CROSSING_SNAP of a tube both axes
    // snap, which would be testing the crossing rule instead of the run.
    expect(snapToBeam({ x: midX(6), y: lastY - 4 }, beams)).toEqual({ x: midX(6), y: lastY })
    expect(snapToBeam({ x: 9999, y: lastY - 4 }, beams)).toEqual({ x: RUN_X[1], y: lastY })
  })

  it('is idempotent — clampToVenue re-snaps an already snapped position', () => {
    for (const p of [
      // ⚠ was `midY(2)` with only three cross-runs, so it evaluated to NaN and the
      // case was vacuous — `toEqual` treats NaN as equal to NaN, so it passed while
      // testing nothing at all.
      { x: lastX - 3, y: midY(1) },
      { x: midX(1), y: YS[1] + 10 },
      { x: XS[2] + 32, y: YS[0] + 10 },
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
   * Where a fixture may end up is now the two families' runs rather than the truss
   * RECTANGLE, and the one thing that must not change is the deck: x from 4432 is
   * open to the sky and carries no steel, so nothing may hang there. The cross-runs
   * end with the roof at 4423, which is what still holds — it is no longer the
   * outermost tube at 4208 doing it, because a fixture riding a cross-run is now
   * free to slide the last 215 cm of roofed hall past that tube.
   *
   * ⚠ This used to assert that the result equalled the nearest member of EACH
   * family, i.e. a crossing. That is no longer true and is no longer the point: one
   * axis is on a beam (source doc §12) and the other is anywhere along its run.
   */
  it('cannot put a fixture where the truss is not, deck included', () => {
    const deckStart = resort.restricted!.find((z) => z.kind === 'kabalatPanim')!.x
    const probes = [
      { x: 6000, y: 1500 },
      { x: 5000, y: 900 },
      { x: deckStart, y: 1200 },
      { x: resort.size.width, y: resort.size.depth },
      // and a point deep in the southern half of the hall, which the old clamp
      // could not reach at all
      { x: 2000, y: 2000 },
    ]
    for (const p of probes) {
      const snapped = snapToBeam(p, beams)
      // the invariant: always ON a beam of one family or the other
      expect(XS.includes(snapped.x) || YS.includes(snapped.y)).toBe(true)
      // and inside both runs, so never over the open deck
      expect(snapped.x).toBeLessThanOrEqual(RUN_X[1])
      expect(snapped.x).toBeLessThan(deckStart)
      expect(snapped.y).toBeGreaterThanOrEqual(RUN_Y[0])
      expect(snapped.y).toBeLessThanOrEqual(RUN_Y[1])
    }
    // The case that was broken, in full: (2000, 2000) used to come back with y
    // frozen on 1306. It now keeps the y the pointer gave it and rides the nearest
    // tube — read off the catalogue, never written down (AGENT-BRIEF §1.7).
    const nearestX = XS.reduce((a, b) => (Math.abs(b - 2000) < Math.abs(a - 2000) ? b : a))
    expect(snapToBeam({ x: 2000, y: 2000 }, beams)).toEqual({ x: nearestX, y: 2000 })
    expect(2000).toBeGreaterThan(Math.max(...YS))
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
