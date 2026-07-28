/**
 * The DRAWABLE form of the ceiling beam grid: where each beam runs across the
 * plan, and where the two families cross.
 *
 * Kept beside `beams.ts` rather than inside it because that file owns the snapping
 * rules and this one owns nothing but geometry — and because vitest runs in `node`
 * (vite.config.ts), so the 2D lighting-plan layer cannot be covered directly. This
 * is the part of it that can be.
 *
 * ⚠ `CeilingBeams.axis` is the axis a beam RUNS ALONG, so an `axis: 'y'` family
 * stands at those *x* values. Reading it the other way round rotates the whole
 * grid 90° and still looks entirely plausible in the viewport — which is why the
 * test pins these against `snapToBeam` instead of against literals.
 */
import type { Vec2 } from '../model/types'
import type { CeilingBeams } from '../venuePacks'

/** One beam as a plan segment. `axis` is the direction it RUNS, as in `CeilingBeams`. */
export interface BeamSpan {
  axis: 'x' | 'y'
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Every beam of every family, stretched across the venue rectangle. */
export function beamSpans(
  beams: CeilingBeams[],
  venue: { width: number; depth: number },
): BeamSpan[] {
  const spans: BeamSpan[] = []
  for (const family of beams) {
    for (const at of family.positions) {
      // a family running along y stands at x = at and reaches across the depth
      if (family.axis === 'y') spans.push({ axis: 'y', x1: at, y1: 0, x2: at, y2: venue.depth })
      else spans.push({ axis: 'x', x1: 0, y1: at, x2: venue.width, y2: at })
    }
  }
  return spans
}

/**
 * The points where the two families meet — the ONLY places a ceiling fixture may
 * hang, because `snapToBeam` snaps to a crossing and not to a beam (beams.ts).
 * Marking them is what tells the user why a chandelier "jumps": on the resort
 * grid that is 9 × 4 = 36 points spread over the whole hall.
 */
export function beamCrossings(beams: CeilingBeams[]): Vec2[] {
  const xs = beams.find((b) => b.axis === 'y')?.positions ?? []
  const ys = beams.find((b) => b.axis === 'x')?.positions ?? []
  const points: Vec2[] = []
  for (const x of xs) {
    for (const y of ys) points.push({ x, y })
  }
  return points
}
