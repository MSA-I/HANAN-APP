/**
 * Where a ceiling fixture may hang, and how far down.
 *
 * Source doc §12: "all the chandeliers can only hang from the warp-and-weft
 * beams of the ceiling, they cannot be left floating in the air". The venue pack
 * carries the grid in `ceilingBeams`.
 *
 * ⚠ Where that grid comes from changed on 2026-07-29, and the old provenance is
 * still quoted around the codebase. It was NOT measured off the truss: it was a
 * hand transcription of 72 `HalfCoupler` clamps, and the clamps grip the tube
 * from its +x side, so every one of the nine along-y values sat 11-22 cm east of
 * the steel and two whole tubes were missing. The eleven along-y positions are
 * now extracted from `venue.glb` itself (`tools/glb-prep/extract-beams.mjs`:
 * ⌀7 cm tubes, x = 158 + 405k, band 909-916); the three along-x runs are the real
 * truss as given by the venue owner, because nothing runs along x in the model at
 * all. Full measurement and per-beam deltas: `Plans/R3/handoff/01-beams.md`.
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
  // The fallback declares its own runs — wall to wall, since a procedural room has
  // no truss to be shorter than it. Emitting them here is what keeps `snapToBeam`
  // free of a `venue` parameter: every family it is handed already knows its length.
  return [
    { axis: 'y', positions: evenSpan(venue.width), height: 0, span: [0, venue.depth] },
    { axis: 'x', positions: evenSpan(venue.depth), height: 0, span: [0, venue.width] },
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
 * pulled onto the crossing as well.
 *
 * ⚠ This used to be justified as "one beam width — the truss members measure up
 * to 35 cm across". That is now measurably wrong: the tubes are ⌀7 cm
 * (handoff/01-beams.md §2.1). The NUMBER is kept, because it was never really
 * about the steel — it is the reach at which a user aiming at a crossing gets
 * one, and 35 cm is about half the 55 cm body of the fixtures that actually hang
 * up there. Treating it as a beam half-width and shrinking it to 3.5 cm would
 * make crossings practically unhittable by hand.
 */
const CROSSING_SNAP = 35

/**
 * Hold the FREE coordinate to the run of the beam it rides. A family with no
 * declared span bounds nothing and leaves the axis exactly where it was.
 *
 * ⚠ This replaced `withinSpan`, which clamped the free coordinate to the
 * outermost members of the OTHER family — the truss RECTANGLE rather than the
 * beam. On the resort that rectangle is x 158…4208 by y 102…1306 inside a
 * 6051 × 2544 hall, so dragging a chandelier to (2000, 2000) snapped x to 2183
 * and froze y on 1306: the whole southern half of the room was unreachable, and
 * because the fixture stuck to the boundary instead of following the pointer it
 * read as the ghost having come loose from the cursor. A beam is a line, not a
 * rectangle — its length is the family's own `span` (venuePacks.ts) — so the
 * fixture now runs the beam end to end and only the ENDS stop it.
 *
 * `beamSpans` reads the same field first, so the plan and the snap still describe
 * the same figure.
 */
function withinRun(family: CeilingBeams | undefined, v: number): number {
  const run = family?.span
  if (!run) return v
  return Math.min(Math.max(v, run[0]), run[1])
}

/**
 * Snap to the nearest BEAM, sliding freely along it. The previous behaviour
 * snapped both axes at once — to a crossing — which on the resort grid is 33
 * discrete points in the whole hall and reads to the user as "the chandelier is
 * locked" (source doc §32). The invariant it protected is kept: the fixture is
 * always on a beam, never floating mid-bay (source doc §12).
 *
 * The closer family carries the fixture. A crossing is still reachable: it is
 * where the two families' snap regions meet — come within `CROSSING_SNAP` of a
 * member of the other family too and both axes snap.
 *
 * The free coordinate is held to the RUN of the beam the fixture rides — the
 * family's declared `span` — so it cannot slide off the end of the steel into
 * open air, but it can reach every point along it. A fixture riding an `axis: 'y'`
 * beam is free in y, so the bound is that family's own span; riding an
 * `axis: 'x'` cross-run it is free in x, bounded by the x family's span.
 *
 * A family that is missing (a pack with beams in one direction only) leaves that
 * axis untouched rather than collapsing the fixture onto a single line, and so
 * does a family that declares no span.
 */
export function snapToBeam(pos: Vec2, beams: CeilingBeams[]): Vec2 {
  // axis is the run direction, so an 'y' family constrains x and vice versa
  const familyY = beams.find((b) => b.axis === 'y')
  const familyX = beams.find((b) => b.axis === 'x')
  const bx = nearest(familyY?.positions ?? [], pos.x)
  const by = nearest(familyX?.positions ?? [], pos.y)
  const dx = bx === null ? Infinity : Math.abs(bx - pos.x)
  const dy = by === null ? Infinity : Math.abs(by - pos.y)
  // ties go to x, so the result never depends on the order of two equal distances
  return {
    // x free means y snapped, i.e. the fixture rides a cross-run: its length is
    // how far the 'x' family runs along x
    x: bx !== null && (dx <= dy || dx <= CROSSING_SNAP) ? bx : withinRun(familyX, pos.x),
    y: by !== null && (dy < dx || dy <= CROSSING_SNAP) ? by : withinRun(familyY, pos.y),
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
 * The anchor is `hangHeight` (895 in the resort) and NOT the beam geometry above
 * it, so the fixture's top and the beam are not quite touching.
 *
 * ⚠ The reason that used to be fine no longer holds, and the fix is NOT here.
 * Round 2 built the bridging cord, photographed it from six angles and reverted
 * it, on the grounds that "the beam is up to 35 cm across and hides everything
 * directly beneath it" (`Plans/R2/handoff/FOUND-05-A2.md` §1). The 2026-07-29
 * extraction measured the tubes at **⌀7 cm**, underside 909, so a 7 cm tube is
 * being asked to hide a 14 cm gap and cannot: the fixture reads as hanging in
 * air just below the steel, which is the second half of source-doc item 8.
 *
 * Leaving it alone deliberately. The wrong number is `hangHeight` itself — 895
 * predates the measurement and wants to be the 909 underside — and that lives in
 * `venuePacks.ts`, which this plan does not own. Bridging the gap here instead
 * would paper over it and then double up if the anchor is ever corrected.
 * Written up in `Plans/R3/FOUND-08.md` §2.
 */
export function cordLength(
  pack: Pick<VenuePack, 'hangHeight'> | undefined,
  wallHeight: number,
  height: number,
  elevation: number,
): number {
  return Math.max(0, (pack?.hangHeight ?? wallHeight) - (elevation + height))
}
