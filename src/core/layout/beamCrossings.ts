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
 * Every beam of every family, drawn over exactly the stretch a fixture may slide
 * along. That stretch is the family's declared `span` (venuePacks.ts) — the same
 * field `withinRun` holds a sliding fixture to (`beams.ts`) — so the drawing and
 * the snap describe the same figure by construction. They are the same promise
 * made twice: a line says "a fixture can hang here", and `snapToBeam` decides
 * whether one actually can. Change one without the other and the 2D lighting plan
 * starts lying.
 *
 * ⚠ Two wrong answers preceded this one, in opposite directions. First the spans
 * were stretched across the venue RECTANGLE, so on the resort the three cross-runs
 * ran from x 0 to x 6051 — 1.8 m past the outermost tube and straight over the
 * open reception deck (source doc item 9b). Then they were bounded by the
 * outermost members of the OTHER family, which drew the truss RECTANGLE, x
 * 158…4208 by y 102…1306: honest about the crossings but 12 m short along the
 * eleven tubes, which really do run the full depth of the hall. A beam's length is
 * a property of the beam, so the pack now states it and this reads it.
 *
 * The fallbacks below are for hand-built families in tests and for any future pack
 * that omits `span`: the old other-family rectangle first, then the venue.
 */
export function beamSpans(
  beams: CeilingBeams[],
  venue: { width: number; depth: number },
): BeamSpan[] {
  const alongY = beams.find((b) => b.axis === 'y')?.positions ?? []
  const alongX = beams.find((b) => b.axis === 'x')?.positions ?? []
  // a lone family bounds nothing, and `withinRun` leaves that axis free, so the
  // drawing follows it across the whole room rather than collapsing to a point
  const inferredY: [number, number] = alongX.length
    ? [Math.min(...alongX), Math.max(...alongX)]
    : [0, venue.depth]
  const inferredX: [number, number] = alongY.length
    ? [Math.min(...alongY), Math.max(...alongY)]
    : [0, venue.width]
  const spans: BeamSpan[] = []
  for (const family of beams) {
    // `span` is measured along the family's OWN axis, which is the coordinate the
    // segment sweeps; the position it stands at is on the perpendicular one
    const [from, to] = family.span ?? (family.axis === 'y' ? inferredY : inferredX)
    for (const at of family.positions) {
      // a family running along y stands at x = at and reaches across the depth
      if (family.axis === 'y') spans.push({ axis: 'y', x1: at, y1: from, x2: at, y2: to })
      else spans.push({ axis: 'x', x1: from, y1: at, x2: to, y2: at })
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
