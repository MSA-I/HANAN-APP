/**
 * Where a ceiling fixture may hang, and how far down.
 *
 * Source doc §12: "all the chandeliers can only hang from the warp-and-weft
 * beams of the ceiling, they cannot be left floating in the air". The venue pack
 * carries the real grid in `ceilingBeams`, measured off the lighting truss in the
 * SketchUp model (see Plans/handoff/07-venue-data.md §1.5).
 *
 * ⚠ `CeilingBeams.axis` is the axis a beam RUNS ALONG, so its `positions` are
 * coordinates on the PERPENDICULAR axis: an `axis: 'y'` family is a set of beams
 * standing at those *x* values. Reading it the other way round rotates the whole
 * grid 90°, which still looks plausible in the viewport — hence this note.
 */
import type { Vec2 } from '../model/types'
import type { CeilingBeams, VenuePack } from '../venuePacks'

/**
 * Source doc §13: "every chandelier can be at any height, up to 4 m from the
 * ceiling". Measured from the CEILING — the roof at `wallHeight` — not from the
 * truss it hangs off. Confirmed by the user 2026-07-28.
 *
 * The distinction is the whole range: the resort's truss already sits 2.65 m
 * below its 11.6 m roof, so of the 4 m only 1.35 m is left to give. Reading it
 * off the truss instead would let a fixture drop to 4.95 m — well past the limit.
 */
export const MAX_DROP_FROM_CEILING = 400

/** ponytail: uniform grid fallback, real beams when the model provides them. */
const FALLBACK_SPACING = 250

/**
 * The grid to snap against. A pack without measured beams (and every procedural
 * room) gets an even lattice inset one full bay from the walls, so a fixture still
 * lands somewhere deliberate instead of wherever the pointer happened to be.
 */
export function beamGrid(
  pack: Pick<VenuePack, 'ceilingBeams'> | undefined,
  venue: { width: number; depth: number },
): CeilingBeams[] {
  if (pack?.ceilingBeams?.length) return pack.ceilingBeams
  return [
    { axis: 'y', positions: evenSpan(venue.width), height: 0 },
    { axis: 'x', positions: evenSpan(venue.depth), height: 0 },
  ]
}

/** Interior grid lines every 250 cm, inset half a bay so nothing sits on a wall. */
function evenSpan(extent: number): number[] {
  const count = Math.floor(extent / FALLBACK_SPACING)
  if (count < 1) return [extent / 2]
  const inset = (extent - (count - 1) * FALLBACK_SPACING) / 2
  return Array.from({ length: count }, (_, i) => inset + i * FALLBACK_SPACING)
}

function nearest(values: number[], v: number): number | null {
  if (!values.length) return null
  return values.reduce((best, candidate) =>
    Math.abs(candidate - v) < Math.abs(best - v) ? candidate : best,
  )
}

/**
 * Snap to the nearest beam CROSSING, not just to the nearest beam.
 *
 * A crossing is the only point where both families support the fixture, it is
 * what the eye reads as "hung from the grid", and it keeps the rule predictable:
 * one drop point per intersection, no fixture floating along a span. Freedom to
 * slide along a beam can be added later; it cannot be taken back.
 *
 * A family that is missing (a pack with beams in one direction only) leaves that
 * axis untouched rather than collapsing the fixture onto a single line.
 */
export function snapToBeam(pos: Vec2, beams: CeilingBeams[]): Vec2 {
  // axis is the run direction, so an 'y' family constrains x and vice versa
  const x = nearest(beams.find((b) => b.axis === 'y')?.positions ?? [], pos.x)
  const y = nearest(beams.find((b) => b.axis === 'x')?.positions ?? [], pos.y)
  return { x: x ?? pos.x, y: y ?? pos.y }
}

/**
 * Legal elevations for a fixture of this height: from the hang anchor (its top
 * touching the truss, the seeded value) down to the ceiling limit.
 *
 * The TOP of the fixture may not fall below `wallHeight − MAX_DROP_FROM_CEILING`.
 * A truss that already hangs far below the roof therefore leaves less to give,
 * and one flush with it leaves the full 4 m — which is the point of measuring
 * from the ceiling rather than from the anchor.
 */
export function hangRange(
  pack: Pick<VenuePack, 'hangHeight'> | undefined,
  wallHeight: number,
  height: number,
): { min: number; max: number } {
  const anchor = pack?.hangHeight ?? wallHeight
  const max = anchor - height
  // the lowest the TOP may go, measured down from the ceiling
  const floorOfRange = wallHeight - MAX_DROP_FROM_CEILING - height
  return { min: Math.max(0, Math.min(max, floorOfRange)), max: Math.max(0, max) }
}

export function clampHang(
  pack: Pick<VenuePack, 'hangHeight'> | undefined,
  wallHeight: number,
  height: number,
  elevation: number,
): number {
  const { min, max } = hangRange(pack, wallHeight, height)
  return Math.min(max, Math.max(min, elevation))
}

/**
 * Length of the procedural cord bridging the fixture's top to the truss. Zero at
 * the seeded elevation — the GLB already models its own drop there — and grows as
 * the user pulls the fixture down.
 */
export function cordLength(
  pack: Pick<VenuePack, 'hangHeight'> | undefined,
  wallHeight: number,
  height: number,
  elevation: number,
): number {
  return Math.max(0, (pack?.hangHeight ?? wallHeight) - (elevation + height))
}
