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

/**
 * Every beam of every family, drawn over the TRUSS rectangle — the stretch each
 * beam is bounded by the outermost members of the other family, which is exactly
 * the range `withinSpan` holds a sliding fixture to (`beams.ts`).
 *
 * ⚠ It used to stretch them across the venue rectangle instead, and on the resort
 * that drew the three cross-runs from x 0 to x 6051 — straight over the reception
 * deck, which starts at 4432, is open to the sky and carries no truss at all. The
 * outermost tube is at 4208, so `snapToBeam` can never put a fixture out there:
 * the plan was drawing beams into a region where nothing can hang, which is the
 * source doc's item 9b ("the warp and weft in the 2D plan does not reflect the
 * real state of the beams"). Now the picture and the snap agree by construction.
 *
 * The tubes really do run further than this — y −193…2531, the full depth and
 * 193 cm past the north wall (handoff/01-beams.md §5). What is drawn is the part
 * a fixture can use, not the mill length of the steel.
 */
export function beamSpans(
  beams: CeilingBeams[],
  venue: { width: number; depth: number },
): BeamSpan[] {
  const alongY = beams.find((b) => b.axis === 'y')?.positions ?? []
  const alongX = beams.find((b) => b.axis === 'x')?.positions ?? []
  // a lone family bounds nothing, and `withinSpan` leaves that axis free, so the
  // drawing follows it across the whole room rather than collapsing to a point
  const [top, bottom] = alongX.length ? [Math.min(...alongX), Math.max(...alongX)] : [0, venue.depth]
  const [left, right] = alongY.length ? [Math.min(...alongY), Math.max(...alongY)] : [0, venue.width]
  const spans: BeamSpan[] = []
  for (const family of beams) {
    for (const at of family.positions) {
      // a family running along y stands at x = at and reaches across the depth
      if (family.axis === 'y') spans.push({ axis: 'y', x1: at, y1: top, x2: at, y2: bottom })
      else spans.push({ axis: 'x', x1: left, y1: at, x2: right, y2: at })
    }
  }
  return spans
}

/**
 * The points where the two families meet: 11 × 3 = 33 of them on the resort grid.
 *
 * ⚠ That count was 9 × 4 = 36 until the 2026-07-29 re-extraction, and the old
 * number is still quoted in places this file does not own. The y family gained
 * the two tubes the hand transcription never saw, and the x family went from the
 * four rows of hanging fixtures to the three real cross-runs
 * (handoff/01-beams.md). Nothing here is written as a literal, so the arithmetic
 * follows the catalogue on its own.
 *
 * They used to be the ONLY places a ceiling fixture could hang, and marking them
 * was what told the user why a chandelier "jumps". Since PLAN-05/A2 a fixture
 * snaps to the nearest BEAM and slides along it (source doc §32), so these are no
 * longer the whole story — they are the points where both families hold it, which
 * `snapToBeam` still pulls onto from either side. The lines in `beamSpans` are now
 * the part of the drawing that shows where a fixture may actually go.
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
