import { describe, expect, it } from 'vitest'
import { beamCrossings, beamSpans } from './beamCrossings'
import { beamGrid, snapToBeam } from './beams'
import { getVenuePack } from '../venuePacks'

const resort = getVenuePack('resort')!
const beams = beamGrid(resort, resort.size)
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`

describe('beamCrossings', () => {
  it('pairs every beam of one family with every beam of the other', () => {
    const xs = beams.find((b) => b.axis === 'y')!.positions
    const ys = beams.find((b) => b.axis === 'x')!.positions
    expect(beamCrossings(beams)).toHaveLength(xs.length * ys.length)
  })

  /**
   * The guard against reading `axis` as the constrained coordinate instead of the
   * run direction. Swapping the two families keeps the grid looking like a grid,
   * so the only thing that catches it is that the snap target would no longer sit
   * on a line this file draws — the two families' positions are disjoint sets.
   *
   * ⚠ This used to assert the snapped point was one of the CROSSINGS. `snapToBeam`
   * now snaps the nearer family only and lets the fixture slide along that beam
   * (source doc §32, PLAN-05/A2), so the invariant it can carry is the true one:
   * a fixture is always ON a beam, never floating mid-bay (source doc §12). The
   * crossings stay reachable, and the sweep still reaches some.
   */
  it('draws a beam through every point snapToBeam can produce', () => {
    const xs = beams.find((b) => b.axis === 'y')!.positions
    const ys = beams.find((b) => b.axis === 'x')!.positions
    const marked = new Set(beamCrossings(beams).map(key))
    let onCrossing = 0
    // primes, so the sweep never lands on a beam by construction
    for (let x = 0; x <= resort.size.width; x += 137) {
      for (let y = 0; y <= resort.size.depth; y += 149) {
        const point = snapToBeam({ x, y }, beams)
        expect(xs.includes(point.x) || ys.includes(point.y)).toBe(true)
        if (marked.has(key(point))) onCrossing++
      }
    }
    expect(onCrossing).toBeGreaterThan(0)
  })

  it('marks the procedural room too, so the mode is never empty', () => {
    const fallback = beamGrid(undefined, { width: 1000, depth: 600 })
    expect(beamCrossings(fallback)).toHaveLength(4 * 2)
  })

  it('returns nothing when a family is missing — a lone family has no crossing', () => {
    expect(beamCrossings([{ axis: 'y', positions: [100, 200], height: 900 }])).toEqual([])
    expect(beamCrossings([])).toEqual([])
  })
})

describe('beamSpans', () => {
  const xs = beams.find((b) => b.axis === 'y')!.positions
  const ys = beams.find((b) => b.axis === 'x')!.positions

  it('draws an `axis: y` family as vertical lines and an `axis: x` family as horizontal ones', () => {
    const spans = beamSpans(beams, resort.size)
    const runsY = spans.filter((s) => s.axis === 'y')
    const runsX = spans.filter((s) => s.axis === 'x')
    expect(runsY.every((s) => s.x1 === s.x2)).toBe(true)
    expect(runsX.every((s) => s.y1 === s.y2)).toBe(true)
    expect(runsY.map((s) => s.x1)).toEqual(xs)
    expect(runsX.map((s) => s.y1)).toEqual(ys)
  })

  /**
   * The drawing and the snap have to describe the same rectangle, because they
   * are the same promise made twice: a line says "a fixture can hang here" and
   * `snapToBeam` decides whether one actually can.
   *
   * ⚠ They did not agree before 2026-07-29. The spans were stretched across the
   * PACK rectangle, so on the resort the three cross-runs were drawn from x 0 to
   * x 6051 — 1.8 m past the outermost tube and straight over the open reception
   * deck, where there is no roof, no truss, and no reachable position at all.
   */
  it('draws each beam over exactly the stretch a fixture can slide along', () => {
    const spans = beamSpans(beams, resort.size)
    for (const s of spans.filter((v) => v.axis === 'y')) {
      // the far end of a vertical beam is bounded by the outermost cross-run …
      expect([s.y1, s.y2]).toEqual([Math.min(...ys), Math.max(...ys)])
      // … which is where the snap holds a fixture sliding past either end
      expect(snapToBeam({ x: s.x1, y: -9999 }, beams)).toEqual({ x: s.x1, y: s.y1 })
      expect(snapToBeam({ x: s.x1, y: 9999 }, beams)).toEqual({ x: s.x1, y: s.y2 })
    }
    for (const s of spans.filter((v) => v.axis === 'x')) {
      expect([s.x1, s.x2]).toEqual([Math.min(...xs), Math.max(...xs)])
      expect(snapToBeam({ x: -9999, y: s.y1 }, beams)).toEqual({ x: s.x1, y: s.y1 })
      expect(snapToBeam({ x: 9999, y: s.y1 }, beams)).toEqual({ x: s.x2, y: s.y1 })
    }
  })

  it('never draws a beam over the reception deck, which has no truss', () => {
    // the deck floor starts at x 4432 (venuePacks floorAreas / zones); the last
    // real tube is at 4208, so nothing drawn may reach past it
    const deckStart = 4432
    expect(Math.max(...xs)).toBeLessThan(deckStart)
    for (const s of beamSpans(beams, resort.size)) {
      expect(Math.max(s.x1, s.x2)).toBeLessThan(deckStart)
    }
    // and the pack really is wider than that, so this is not vacuous
    expect(resort.size.width).toBeGreaterThan(deckStart)
  })

  it('follows a lone family across the room, since nothing bounds it', () => {
    const lone = [{ axis: 'y' as const, positions: [100, 200], height: 900 }]
    const spans = beamSpans(lone, { width: 1000, depth: 600 })
    expect(spans.every((s) => s.y1 === 0 && s.y2 === 600)).toBe(true)
    // matching snapToBeam, which leaves an unbounded axis exactly where it was
    expect(snapToBeam({ x: 260, y: 577 }, lone)).toEqual({ x: 200, y: 577 })
  })

  it('puts every crossing on exactly one span of each direction', () => {
    const spans = beamSpans(beams, resort.size)
    for (const point of beamCrossings(beams)) {
      expect(spans.filter((s) => s.axis === 'y' && s.x1 === point.x)).toHaveLength(1)
      expect(spans.filter((s) => s.axis === 'x' && s.y1 === point.y)).toHaveLength(1)
    }
  })
})
