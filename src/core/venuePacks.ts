/**
 * Static registry of venue packs (public/venue-packs/<id>/). A pack is a real
 * hall the user modelled in SketchUp, prepped by tools/glb-prep into a compact
 * GLB. Selecting a pack makes the 3D viewer render that model instead of the
 * procedural room.
 *
 * `offset` is applied to the loaded model (metres) so its bounding-box corner
 * lands at plan origin (three x=0, z=0), and `size`/`wallHeight` (cm) frame the
 * plan/camera. These come from the glb-prep bbox report. Precise floor bounds
 * (excluding the desert backdrop) arrive later via footprint.json.
 */
/**
 * A no-go rectangle in plan cm (top-left corner + size). Furniture is pushed out —
 * EXCEPT catalog entries whose `zoneKind` matches `kind`: those are the zone's own
 * fixed stations (DJ booth in the DJ zone, bar units in the bar zone) and are
 * clamped INTO the zone instead — they cannot leave it.
 */
export interface RestrictedZone {
  x: number
  y: number
  width: number
  depth: number
  /** cm — surface height; zone-bound objects use this as their local 0.00 */
  elevation?: number
  /** hebrew label for the 2D overlay */
  label?: string
  /** stable id from the ZONE_* SketchUp marker (pool, bar, dj, dancefloor…) */
  kind?: string
}

/** A sealed camera angle (from a SketchUp Scene). Coords are app three-metres. */
export interface SealedCamera {
  id: string
  label: string
  position: [number, number, number]
  target: [number, number, number]
  /** vertical field of view, degrees */
  fov: number
  /**
   * The work zone this angle belongs to, matching a `RestrictedZone.kind`. The
   * 3D preset bar only offers angles whose zone is the active one; an angle with
   * no `zone` belongs to the hall and shows by default (source doc §42).
   */
  zone?: string
}

/**
 * One family of parallel ceiling beams. `axis` is the axis each beam RUNS ALONG;
 * `positions` are its coordinates on the PERPENDICULAR axis (plan cm), so an
 * `axis: 'y'` family is a set of beams at those x positions. Two families make
 * the warp-and-weft grid. `height` is the beam level in plan cm — the lighting
 * truss, which sits above `hangHeight`.
 */
export interface CeilingBeams {
  axis: 'x' | 'y'
  positions: number[]
  height: number
}

export interface VenuePack {
  id: string
  name: string
  model: string
  /** metres — added to the model so bbox-min maps to plan origin */
  offset: [number, number, number]
  /** cm — plan footprint used by the 2D editor and camera framing */
  size: { width: number; depth: number }
  /** cm */
  wallHeight: number
  /** cm — ceiling anchor for hung items (the lighting-truss pipe level, not the
   *  roof apex). Chandeliers pin their TOP here; missing → falls back to wallHeight. */
  hangHeight?: number
  /** plan-cm rectangles where furniture may not be placed (pool, fixed stage…) */
  restricted?: RestrictedZone[]
  /** placeable-area polygons (plan cm, from ZONE_FLOOR). Furniture goes only here;
   *  equals size-rectangle minus `restricted`, shown green in the editor. */
  floorAreas?: [number, number][][]
  /** sealed camera angles from SketchUp Scenes (extracted via SimLab). */
  cameras?: SealedCamera[]
  /**
   * True outline of the hall in plan cm (from the union of the ZONE_* markers) —
   * the room is NOT the `size` rectangle. `size` is the bounding box the editor
   * frames and clamps to; this is what the 2D floor should actually be drawn as.
   * Detached parts of the venue (the raised reception deck) are not in here —
   * they are their own `restricted` rectangle.
   */
  outline?: [number, number][]
  /** ceiling beam grid, for hanging and for the 3D structure */
  ceilingBeams?: CeilingBeams[]
  /** hex of the roof-truss metal, read off venue.glb materials — the hang cord matches it
   *  (source doc §16). Absent → the viewer keeps its own default. */
  beamColor?: string
  /**
   * URL of the plan-section asset: the building cut through at eye height, so the
   * 2D view can draw real walls with real openings instead of a fabricated band
   * around `outline`. Produced by tools/glb-prep/extract-section.mjs from THIS
   * pack's model, so the two views describe one building. See core/venueSection.ts.
   *
   * Absent → the plan falls back to stroking `outline`, which is what every pack
   * did before this existed.
   */
  section?: string
}

export const VENUE_PACKS: VenuePack[] = [
  {
    id: 'resort',
    name: 'אולם הריזורט',
    model: '/venue-packs/resort/venue.glb',
    // Align the covered event floor (not the desert backdrop) to plan origin.
    // Roof/floor footprint (raw frame): x∈[-1.87,45.69], z∈[-27.02,0.71]; shift so
    // that corner → three (0,0). Desert (x>46) then falls outside the plan rectangle
    // but still renders in 3D. Verified visually in-app.
    // aligned to ZONE_FLOOR (user-marked floor outline); origin = its min corner.
    // Re-imported 2026-07-28 19:47 from "ריזורט גאמוס - אפליקציה.skp" (the third
    // import of the day, after 01:57 and 18:03). The origin has not moved in any
    // of them: `offset` and the ZONE_FLOOR bbox (4423×2544) come out identical
    // every time, so nothing in a saved project shifts. See
    // Plans/R2/handoff/01c-venue-data.md for the face-by-face measurements.
    offset: [0, 0, 24.861],
    // The hall alone is 4423×2544; the width runs to 6051 because the reception
    // deck (x 4432…6051) shares this plan space. It is DETACHED from the hall —
    // `outline` and `floorAreas` are what is actually solid, not this rectangle.
    size: { width: 6051, depth: 2544 },
    wallHeight: 1160,
    // truss pipe level, measured by the user in the source SKP (2026-07-21).
    // NOT the same as ceilingBeams.height (910): this is where a hung item's top
    // pins, that is the truss centreline above it.
    hangHeight: 895,
    // extracted from ZONE_* marker faces via tools/glb-prep/extract-zones.mjs (plan cm).
    // ⚠ Order is load-bearing, not alphabetical: the chuppah rectangle sits INSIDE
    // the pool one and the DJ one overlaps its top edge, and VenueLayer draws by
    // descending area while the clamp walks this list — reordering changes which
    // zone wins. Leave it.
    // ⚠ A `kind` may appear more than once. `saviv` is four rectangles; the clamp
    // filters by kind and picks the nearest (actions.ts:350), and collision tests
    // membership with `.some()` (collision.ts:456), so repeats are supported.
    restricted: [
      // 19:47: the user redrew this pair, and `pool` is now the WATER ALONE —
      // 889,1611 to 3839,2544. What used to be inside it, the apron along the
      // pool's north and west sides, moved out into ZONE_SAVIV below.
      //
      // This stays ONE rectangle even though the painted face is 87.1% of it: the
      // face is the water bitten out around the chuppah podium, and `pool` FORBIDS.
      // For a forbidding zone the bounding box errs safe — the 3 m² sliver it
      // over-claims is pool edge beside the podium, which is no-go anyway. `saviv`
      // below is the opposite case and is handled the opposite way.
      { x: 889, y: 1611, width: 2950, depth: 933, label: 'בריכה', kind: 'pool' },
      // ZONE_SAVIV is TWO SHAPES, one on each side of the pool — the user's own
      // description, and what the 19:47 geometry shows. It is where he is allowed
      // to stand the vegetation, so it is a PERMISSIVE region, not decoration.
      //
      // Each shape is an L, not a rectangle, so the pair is four rectangles here.
      // Verified by arithmetic, not by eye: the two rectangles of each L sum to
      // that L's triangle area exactly (32.65 m² west, 39.55 m² east, 72.20 m²
      // together, against 72.20 m² of paint).
      //
      // ⚠ Do NOT collapse each shape to its bounding box. The Ls wrap the water's
      // corners, so the west box would be 766,1408,1043×1136 and the east
      // 2579,1408,1383×1136 — between them covering 203 of the pool's 240 m². On
      // a region that says "a plant MAY go here" that puts plants in the water.
      // Four exact rectangles cover 0 m² of it. The clamp reads these with
      // `zones.filter(z => z.kind === zoneKind)` and snaps to the nearest by
      // centre distance (actions.ts:348-382), so the count costs nothing.
      //
      // The east box, 2579,1408,1383×1136, is also the whole story of the 18:03
      // import: back then this kind had only the east shape, and that box IS the
      // rectangle the file used to carry. The overlap with the pool everyone was
      // looking at was never a drawing error — it was one L reported as its box.
      //
      // ⛔ Still missing, and PLAN-06's: a zone in `restricted` rejects everything
      // that touches it (collision.ts:458-464), so a plant standing correctly
      // inside saviv is reported `forbiddenZone`. The pattern to copy is the
      // kabalatPanim branch at :460-463 with `allowedOnDeck`. Until that lands
      // these four rectangles are geometry only.
      { x: 766, y: 1408, width: 1043, depth: 203, label: 'סביב הבריכה', kind: 'saviv' },
      { x: 766, y: 1611, width: 123, depth: 933, label: 'סביב הבריכה', kind: 'saviv' },
      { x: 2579, y: 1408, width: 1383, depth: 203, label: 'סביב הבריכה', kind: 'saviv' },
      { x: 3839, y: 1611, width: 123, depth: 933, label: 'סביב הבריכה', kind: 'saviv' },
      // 15:09: the bar took 50cm out of the dance floor. Together the two still
      // span y 0…1408 exactly, so only the seam between them moved.
      { x: 1789, y: 0, width: 800, depth: 350, label: 'בר', kind: 'bar' },
      { x: 1789, y: 350, width: 800, depth: 1058, label: 'רחבת ריקודים', kind: 'dancefloor' },
      // 15:09: 233 → 243 deep. That import also carries a SECOND ZONE_DJ face, the
      // same size, 460cm to the left — deliberately NOT added. `kind` is matched as
      // a string and a zone-bound object clamps INTO "its" zone, so two rectangles
      // sharing one kind have no defined target. Keeping x here is what keeps the
      // booth in every saved project where the user left it (BLOCKED-01-A1 §2).
      // 19:47 re-measured both faces identical; the user confirmed the pair is
      // intentional (ANSWERS-WAVE-1 §3), so the second one lands with PLAN-06.
      { x: 2269, y: 1408, width: 310, depth: 243, label: 'עמדת DJ', kind: 'dj' },
      // 15:09: re-measured unchanged at 425 deep. 6 of the 8 chuppah models are
      // deeper than that (Plans/R1/handoff/BLOCKED-01-A3.md) — still open.
      { x: 1809, y: 1651, width: 760, depth: 425, elevation: 50, label: 'חופה', kind: 'chuppah' },
      // was `corridor`/'מסדרון' and 2544 deep — the user shortened it (source doc §34).
      // 15:09 rasterises it 4cm deeper; the floor it gave back is floorAreas[2].
      { x: 3962, y: 0, width: 461, depth: 1408, label: 'מעבר', kind: 'passage' },
      // ZONE_KABALAT_PANIM: a RAISED deck (+470cm), detached from the hall floor.
      // Inverted zone — see ALLOWED_IN_KABALAT_PANIM in state/actions.ts: only a
      // chuppah, chairs and buffet tables may be in it, everything else is pushed
      // out (source doc §41).
      { x: 4432, y: 734, width: 1619, depth: 1810, elevation: 470, label: 'קבלת פנים', kind: 'kabalatPanim' },
    ],
    floorAreas: [
      [[0, 0], [1790, 0], [1790, 1410], [770, 1410], [770, 2540], [0, 2540]],
      [[2590, 0], [3960, 0], [3960, 1410], [2590, 1410]],
      // Opened up by the 15:09 import beneath the shortened passage (source doc
      // §29), and at 19:47 the user pulled it down to the south wall. The exact
      // ZONE_FLOOR vertices put it at x 3961.94…4422.51 × y 1407.57…2543.77 —
      // 461×1136, not the 460×1080 the 10cm raster reported off the older save.
      // +2.3 m² of placeable floor. The two rings above came out byte-identical
      // across all three imports, which is what proves the extraction did not drift.
      [[3960, 1410], [4420, 1410], [4420, 2540], [3960, 2540]],
    ],
    // Real room contour. Now that floorAreas[2] reaches the south wall the 460×50
    // notch in the south-east corner is gone and the contour is a plain rectangle
    // — this time because the floor genuinely is one, not because the outline was
    // unknown and fell back to `size`.
    outline: [[0, 0], [4420, 0], [4420, 2540], [0, 2540]],
    // Lighting-truss grid: 9 beams along y × 4 along x, all at one level. Read off
    // the 72 `HalfCoupler` clamps in the SKP (72 = 36 crossings × 2), whose centres
    // sit at z = 9.097m with no spread. See Plans/R1/handoff/07-venue-data.md §1.5.
    // Re-measured on the 15:09 import: same 72 clamps, every centre within 4cm of
    // the values below. The 19:47 SKP still carries 288 HalfCoupler nodes — the
    // same 72 clamps × 4 parts — so the truss was not touched. Left alone: a
    // "correction" would slide a snap grid that already lands on the real beams.
    ceilingBeams: [
      { axis: 'y', positions: [578, 988, 1389, 1798, 2194, 2599, 3011, 3420, 3821], height: 910 },
      { axis: 'x', positions: [190, 550, 904, 1270], height: 910 },
    ],
    // Roof-truss metal, off the venue.glb material `H08_Emerald_Abyss` (no texture —
    // the factor IS the colour). glTF stores baseColorFactor LINEAR, [0.725, 0.635,
    // 0.533]. This is that colour in sRGB, which is what THREE.Color('#…') takes.
    // ⚠ Do NOT "fix" this to #b9a288 — that is the linear triple written out as hex
    // and it renders the beam far too light. Re-read off the 19:47 build: same
    // factor, still no texture.
    beamColor: '#ddd1c1',
    // Cut from THIS venue.glb by tools/glb-prep/extract-section.mjs, two planes:
    // 1.00 m over the hall and 5.70 m over the reception deck, because the deck
    // floor is 4.70 m up and one plane cannot catch both. 170 polylines, 114 of
    // them closed — those are the wall cross-sections the plan fills as poché.
    // `--clip` throws away the 126 that lay wholly outside this pack's rectangle:
    // the model carries the rest of the building and a desert backdrop.
    // ⚠ Re-run it whenever venue.glb changes, or the plan draws the old building:
    //   node tools/glb-prep/extract-section.mjs public/venue-packs/resort/venue.glb --offset 0,24.861 --clip 0,0,6051,2544
    section: '/venue-packs/resort/section.json',
    // SketchUp Scenes → app three-metres via (x, z, 24.861 − y). Extracted from
    // SimLab Scene nodes (tools flow: SimLab session on the SKP → read Scene N).
    // Cameras do NOT survive the GLB export, so inspect-cameras.mjs reports 0 —
    // the session is the only source. Re-read on the 15:09 AND the 19:47 imports:
    // still 7 Scenes, positions identical to 4 decimals. Nothing to update here.
    cameras: [
      { id: 's1', label: 'זווית 1', position: [0.34, 1.77, 0.79], target: [20.45, 1.7, 11.52], fov: 45 },
      { id: 's2', label: 'זווית 2', position: [44.23, 1.6, 0.75], target: [28.71, 1.41, 8.77], fov: 45 },
      { id: 's3', label: 'זווית 3', position: [21.86, 1.55, 0.18], target: [22.22, 1.35, 16.27], fov: 45 },
      { id: 's4', label: 'זווית 4 (מוגבה)', position: [0.09, 6.71, 20.88], target: [20.1, 0.52, 1.99], fov: 45 },
      { id: 's5', label: 'זווית 5 (מוגבה)', position: [45.25, 6.97, 0.6], target: [28.57, 4.34, 10.44], fov: 45 },
      // Scenes 6-7. Both stand 1.6m above the 4.70m deck — that eye height is the
      // evidence they are the reception angles (§42).
      { id: 'k1', label: 'קבלת פנים 1', position: [45.24, 6.32, 7.6], target: [54.93, 6.31, 24.45], fov: 45, zone: 'kabalatPanim' },
      { id: 'k2', label: 'קבלת פנים 2', position: [60.01, 6.38, 24.35], target: [45.05, 5.92, 13.92], fov: 45, zone: 'kabalatPanim' },
    ],
  },
]

export function getVenuePack(id: string | null | undefined): VenuePack | undefined {
  if (!id) return undefined
  return VENUE_PACKS.find((p) => p.id === id)
}
