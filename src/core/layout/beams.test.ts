import { describe, expect, it } from 'vitest'
import { beamGrid, clampHang, cordLength, hangRange, MAX_DROP_FROM_CEILING, snapToBeam } from './beams'
import { getVenuePack } from '../venuePacks'

const resort = getVenuePack('resort')!
const beams = resort.ceilingBeams!

describe('snapToBeam', () => {
  it('lands on the nearest crossing of the two families', () => {
    // axis:'y' beams sit at x [578…3821]; axis:'x' beams sit at y [190…1270]
    expect(snapToBeam({ x: 1000, y: 200 }, beams)).toEqual({ x: 988, y: 190 })
    expect(snapToBeam({ x: 3800, y: 1200 }, beams)).toEqual({ x: 3821, y: 1270 })
  })

  it('reads `axis` as the run direction, not as the constrained coordinate', () => {
    // 550 is a valid Y line and 578 a valid X one; swapping the families would
    // return {x:550,y:578} for a point near the corner of the grid
    expect(snapToBeam({ x: 560, y: 560 }, beams)).toEqual({ x: 578, y: 550 })
  })

  it('clamps to the outermost beam outside the grid', () => {
    expect(snapToBeam({ x: -900, y: 9000 }, beams)).toEqual({ x: 578, y: 1270 })
  })

  it('leaves an axis alone when its family is missing', () => {
    const onlyY = [{ axis: 'y' as const, positions: [100, 200], height: 900 }]
    expect(snapToBeam({ x: 260, y: 777 }, onlyY)).toEqual({ x: 200, y: 777 })
    expect(snapToBeam({ x: 260, y: 777 }, [])).toEqual({ x: 260, y: 777 })
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
  const chandelier = 90 // lamp.chandelier-diamond

  it('runs from the truss line down to 4 m below the CEILING', () => {
    // top starts at hangHeight 895 − 90 = 805. The floor of the range is measured
    // off the roof, not the truss: 1160 − 400 − 90 = 670.
    expect(hangRange(resort, resort.wallHeight, chandelier)).toEqual({ min: 670, max: 805 })
    // the truss is already 265 cm below the roof, so only 135 of the 4 m is left
    const trussBelowRoof = resort.wallHeight - (resort.hangHeight ?? resort.wallHeight)
    expect(805 - 670).toBe(MAX_DROP_FROM_CEILING - trussBelowRoof)
  })

  it('gives the full drop when the anchor IS the ceiling', () => {
    // no truss: the anchor is wallHeight, so the whole 4 m is available
    expect(hangRange(undefined, 1160, 90)).toEqual({ min: 670, max: 1070 })
  })

  it('never inverts when the ceiling limit sits above the anchor', () => {
    // a low room: wallHeight 350 puts the limit below zero, so min floors at 0
    expect(hangRange(undefined, 350, 50)).toEqual({ min: 0, max: 300 })
  })

  it('clamps both ends', () => {
    expect(clampHang(resort, resort.wallHeight, chandelier, 9999)).toBe(805)
    expect(clampHang(resort, resort.wallHeight, chandelier, 0)).toBe(670)
    expect(clampHang(resort, resort.wallHeight, chandelier, 700)).toBe(700)
  })
})

describe('cordLength', () => {
  it('is zero at the seeded elevation and grows as the fixture drops', () => {
    expect(cordLength(resort, resort.wallHeight, 90, 805)).toBe(0)
    expect(cordLength(resort, resort.wallHeight, 90, 405)).toBe(400)
  })

  it('never goes negative if a fixture sits above the anchor', () => {
    expect(cordLength(resort, resort.wallHeight, 90, 900)).toBe(0)
  })
})
