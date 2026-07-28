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
 * Corrections doc §9: "add more drop distance from the ceiling, up to 6.5 m from
 * the ceiling" — the round-2 pass raised the earlier 4 m. Still measured from the
 * CEILING — the roof at `wallHeight` — not from the truss the fixture hangs off.
 *
 * The distinction is what the slider is worth: the resort's truss already sits
 * 2.65 m below its 11.6 m roof, so of the 6.5 m only 3.85 m is left to give
 * (135 cm under the old 4 m). Reading it off the truss instead would put the
 * tallest fixture's foot at 895 − 650 − 300 = −55 cm, i.e. through the floor.
 */
export const MAX_DROP_FROM_CEILING = 650

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
 * How close to a beam of the OTHER family the fixture has to be before it is
 * pulled onto the crossing as well. One beam width: the truss members measure up
 * to 35 cm across (Plans/R2/handoff/01-venue-data.md §6), so this is the region
 * where the fixture is genuinely over both members at once.
 */
const CROSSING_SNAP = 35

/** The stretch of a beam that is really there: from the first perpendicular member to the last. */
function withinSpan(positions: number[], v: number): number {
  if (!positions.length) return v
  return Math.min(Math.max(v, Math.min(...positions)), Math.max(...positions))
}

/**
 * Snap to the nearest BEAM, sliding freely along it. The previous behaviour
 * snapped both axes at once — to a crossing — which on the resort grid is 36
 * discrete points in the whole hall and reads to the user as "the chandelier is
 * locked" (source doc §32). The invariant it protected is kept: the fixture is
 * always on a beam, never floating mid-bay (source doc §12).
 *
 * The closer family carries the fixture. A crossing is still reachable: it is
 * where the two families' snap regions meet — come within `CROSSING_SNAP` of a
 * member of the other family too and both axes snap.
 *
 * The free coordinate is held inside the run of the beam, which is bounded by
 * the outermost members of the other family — a fixture cannot slide off the end
 * of the truss into open air. That also keeps a point far outside the grid
 * landing on the nearest corner crossing, exactly as before.
 *
 * A family that is missing (a pack with beams in one direction only) leaves that
 * axis untouched rather than collapsing the fixture onto a single line.
 */
export function snapToBeam(pos: Vec2, beams: CeilingBeams[]): Vec2 {
  // axis is the run direction, so an 'y' family constrains x and vice versa
  const alongY = beams.find((b) => b.axis === 'y')?.positions ?? []
  const alongX = beams.find((b) => b.axis === 'x')?.positions ?? []
  const bx = nearest(alongY, pos.x)
  const by = nearest(alongX, pos.y)
  const dx = bx === null ? Infinity : Math.abs(bx - pos.x)
  const dy = by === null ? Infinity : Math.abs(by - pos.y)
  // ties go to x, so the result never depends on the order of two equal distances
  return {
    x: bx !== null && (dx <= dy || dx <= CROSSING_SNAP) ? bx : withinSpan(alongY, pos.x),
    y: by !== null && (dy < dx || dy <= CROSSING_SNAP) ? by : withinSpan(alongX, pos.y),
  }
}

/**
 * Legal elevations for a fixture of this height: from the hang anchor (its top
 * touching the truss, the seeded value) down to the ceiling limit.
 *
 * The TOP of the fixture may not fall below `wallHeight − MAX_DROP_FROM_CEILING`.
 * A truss that already hangs far below the roof therefore leaves less to give,
 * and one flush with it leaves the full 6.5 m — which is the point of measuring
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
 *
 * The anchor is `hangHeight` (895 in the resort) and NOT the beam geometry 15 cm
 * above it (910), even though the fixture's top and the beam are then not quite
 * touching. That was measured and photographed rather than assumed: bridging the
 * last 15 cm changes nothing a user can see, because the beam is up to 35 cm
 * across and hides everything directly beneath it (`Plans/R2/handoff/FOUND-05-A2.md`
 * §1, with the pixel diffs). Drawing a cord no camera can find is cost with no
 * picture attached.
 */
export function cordLength(
  pack: Pick<VenuePack, 'hangHeight'> | undefined,
  wallHeight: number,
  height: number,
  elevation: number,
): number {
  return Math.max(0, (pack?.hangHeight ?? wallHeight) - (elevation + height))
}
