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
  /**
   * How far each beam of this family RUNS along `axis`, in plan cm. Absent =
   * unbounded (a hand-built family in a test), which leaves that coordinate
   * exactly where the pointer put it.
   *
   * This is PACK data, not scene data — it describes steel that is already in the
   * building, so nothing saved has to migrate. It exists because the run used to
   * be INFERRED from the outermost members of the other family, which on the
   * resort meant a fixture could only ever reach y ∈ [102, 1306] of a 2544-deep
   * hall: the whole southern half was unreachable and the free axis froze on the
   * boundary. A beam's length is a property of the beam, so it is stated.
   */
  span?: [number, number]
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
   * URL of the wall asset: the building's walls in plan, traced by hand in the
   * SketchUp source with the `ZONE_CUT` material and read back by
   * tools/glb-prep/extract-cut.mjs. See core/venueCut.ts for why this replaced
   * slicing the model at a chosen height.
   *
   * Absent → the plan falls back to stroking `outline`, which is what every pack
   * did before this existed.
   */
  cut?: string
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
      // Re-measured 2026-07-29 off a fresh export of the SKP: 2269→2259 and 310→320
      // wide. The RIGHT edge did not move — 2269+310 and 2259+320 are both 2579 —
      // so the new rectangle is a strict SUPERSET of the old one and no saved booth
      // becomes illegal. The second pad is at the bottom of this list (source doc §2).
      { x: 2259, y: 1408, width: 320, depth: 243, label: 'עמדת DJ', kind: 'dj' },
      // 15:09: re-measured unchanged at 425 deep. 6 of the 8 chuppah models are
      // deeper than that (Plans/R1/handoff/BLOCKED-01-A3.md) — still open.
      { x: 1809, y: 1651, width: 760, depth: 425, elevation: 50, label: 'חופה', kind: 'chuppah' },
      // ZONE_SHVIL_HUPA, painted 2026-07-29: the aisle to the ceremony, and the
      // home of the chuppah DECORATIONS (the canopy itself keeps `chuppah`). It
      // runs north from y 1651 — the ceremony pad's own top edge, met exactly, so
      // the walk and the pad are continuous rather than merely near each other.
      //
      // ⚠ No `elevation`, though the marker face measures 1 cm up. A zone's
      // elevation is the local 0.00 for everything bound to it, and 1 cm is the
      // thickness of a paint stroke, not a step: honouring it would stand every
      // decoration a centimetre off the floor for no reason anyone could see.
      { x: 2119, y: 1051, width: 140, depth: 600, label: 'שביל החופה', kind: 'shvilHupa' },
      // was `corridor`/'מסדרון' and 2544 deep — the user shortened it (source doc §34).
      // 15:09 rasterises it 4cm deeper; the floor it gave back is floorAreas[2].
      { x: 3962, y: 0, width: 461, depth: 1408, label: 'מעבר', kind: 'passage' },
      // ZONE_KABALAT_PANIM: a RAISED deck (+470cm), detached from the hall floor.
      // Inverted zone — see ALLOWED_IN_KABALAT_PANIM in state/actions.ts: only a
      // chuppah, chairs and buffet tables may be in it, everything else is pushed
      // out (source doc §41).
      { x: 4432, y: 734, width: 1619, depth: 1810, elevation: 470, label: 'קבלת פנים', kind: 'kabalatPanim' },
      // ⚠ THE TWO BELOW ARE APPENDED, AND THAT POSITION IS DELIBERATE.
      // Both were `notImported` in manifest.json for a whole round on a reason that
      // was already false: two rectangles CAN share a `kind` — the clamp filters by
      // kind and snaps to the nearest CENTRE (actions.ts:380-391) and collision uses
      // `.some()`. `saviv` above has been four of them all along. Extracted
      // 2026-07-29 from a fresh SimLab export of the SKP; see handoff/01-zones.md.
      //
      // Appended rather than filed next to their siblings for two separate reasons:
      //  1. the push-out loop walks this list IN ORDER and each push moves the box
      //     (actions.ts:437-444), so appending leaves every existing push sequence
      //     byte-identical and applies the new ones last;
      //  2. chuppah.test.ts:33 and viewer3d/planTransform.test.ts:8 both do
      //     `find(z => z.kind === 'chuppah')` and mean the HALL one. Putting the
      //     deck chuppah earlier silently repoints both files at the wrong rectangle.
      { x: 1809, y: 1408, width: 310, depth: 243, label: 'עמדת DJ', kind: 'dj' },
      // The reception deck's own canopy: 470 of deck + the same 50cm riser as the
      // hall marker. It sits wholly inside kabalatPanim, which is FINE — the deck
      // branch runs before the home-zone snap (actions.ts:371-376), so anything
      // standing on the deck is judged by the deck, not by this.
      // ⚠ With two chuppah rects the home snap has a watershed at about x=3500 (the
      // midpoint between centres 2189 and 4991). Source doc §19 also asks for this
      // one to be VISIBLE only while reception is on — that is VenueLayer's call
      // and did NOT land here; it is written up in handoff/01-zones.md §6.
      { x: 4706, y: 2009, width: 571, depth: 426, elevation: 520, label: 'חופה', kind: 'chuppah' },
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
    // GEOMETRY-EXTRACTED 2026-07-29 from venue.glb itself, by
    // tools/glb-prep/extract-beams.mjs. Full measurement, per-beam deltas and the
    // reproduction commands: Plans/R3/handoff/01-beams.md.
    //
    // What is physically there: ELEVEN ⌀7cm tubes (material H08_Emerald_Abyss,
    // nodes 3DGeom-518…528), all running along y, at x = 158 + 405k with no drift,
    // spanning y −193…2531 at height 909–916. `height: 910` is inside the tube, so
    // it stays. NOTHING runs along x at that level — verified at the vertex level:
    // 29123 truss-metal vertices in the 895–935 band fall into those 11 lines and
    // not one lands in the 337cm gaps between them. No diagonal bracing either;
    // 14.PNG shows diagonals on the real truss, but they were never modelled.
    //
    // ⚠ The `axis: 'y'` numbers used to be 578, 988, 1389, 1798, 2194, 2599, 3011,
    // 3420, 3821 — 11 to 22cm east of the tubes, all in the same direction, and
    // missing the tubes at 158 and 4208 entirely. That was not a sloppy transcript:
    // it reproduces the 72 HalfCoupler clamp centres to under 0.5cm. The clamps
    // are just not the beams — they are 36 hand-placed hanging light fixtures
    // gripping the tube from its +x side, which is where the whole offset came
    // from. This is source-doc item 9a, and it explains item 8: a hung item snapped
    // 15cm off the tube it was supposed to hang on.
    //
    // ⚠ `axis: 'x'` DOES NOT COME FROM THE MODEL — it cannot, the cross runs were
    // never built there. It is the real truss, given by the venue owner on
    // 2026-07-29: three runs, 6.02 m apart, the outer two 1.02 m off the wall.
    // The arithmetic closes on the roofed bay and is symmetric either way you
    // measure it: 102 + 602 + 602 + 102 = 1408, which is exactly where the roofed
    // hall ends and the open pool deck begins. It used to hold 190/550/904/1270 —
    // those are the 4 rows of the 36 hanging fixtures, measured off the GLB to
    // under 0.5cm, accurate but not tubes. They are kept in the manifest note, not
    // here, because this array is a SNAP GRID enforced on five code paths, and a
    // fixture must land on something a clamp can actually grip.
    //
    // `span` is how far each beam RUNS, and it is the length of the STEEL, not the
    // reach of the other family. The tubes measure y −193.4…2530.6 (handoff/01-beams
    // .md §5); the part inside the plan is 0…2531, and 2531 is what is declared —
    // NOT the 2544 of the south wall, because the modelled tube stops 13 cm short
    // of it and a beam that ends where the wall is would be an invented dimension.
    // The cross-runs are given as ending with the roof at x 4423 (the hall is
    // 4423 × 2544; the deck starts at 4432), which is what keeps nothing hanging
    // over the open reception deck now that the free axis is no longer pinned by
    // the outermost tube at 4208.
    ceilingBeams: [
      { axis: 'y', positions: [158, 563, 968, 1373, 1778, 2183, 2588, 2993, 3398, 3803, 4208], height: 910, span: [0, 2531] },
      { axis: 'x', positions: [102, 704, 1306], height: 910, span: [0, 4423] },
    ],
    // Roof-truss metal, off the venue.glb material `H08_Emerald_Abyss` (no texture —
    // the factor IS the colour). glTF stores baseColorFactor LINEAR, [0.725, 0.635,
    // 0.533]. This is that colour in sRGB, which is what THREE.Color('#…') takes.
    // ⚠ Do NOT "fix" this to #b9a288 — that is the linear triple written out as hex
    // and it renders the beam far too light. Re-read off the 19:47 build: same
    // factor, still no texture.
    beamColor: '#ddd1c1',
    // The walls, as the user PAINTED them in SketchUp with one material, ZONE_CUT
    // — 4,640 triangles, filled as poché. This replaced slicing venue.glb with a
    // horizontal plane, and the replacement is the point: every hard problem the
    // plan had came out of choosing a cut height. The railing vanished because the
    // 1.00 m plane passed through the gap between its rail and its cap; the east
    // wall came out as 36 severed stumps because two cut ranges left a 9 cm strip
    // uncovered; and a door was never identifiable, because the model has no door
    // material and an opening is only the ABSENCE of geometry. A painted face has
    // none of those: no height to guess, an opening is where he did not paint, and
    // the marking lives in the SKP so it survives the next re-import — which
    // matters, because this model was re-imported three times in one day.
    // Rationale in full: src/core/venueCut.ts. ⚠ Re-run after any SKP edit:
    //   mcp simlab_convert  <skp> -> D:/simlab-out/raw-venue-<stamp>.glb
    //   node tools/glb-prep/extract-cut.mjs D:/simlab-out/raw-venue-<stamp>.glb
    cut: '/venue-packs/resort/cut.json',
    // SketchUp Scenes → app three-metres via (x, z, 24.861 − y). Extracted from
    // SimLab Scene nodes (tools flow: SimLab session on the SKP → read Scene N).
    // Cameras do NOT survive the GLB export, so inspect-cameras.mjs reports 0 —
    // the session is the only source. Re-read on the 15:09 AND the 19:47 imports:
    // still 7 Scenes, positions identical to 4 decimals. Nothing to update here.
    cameras: [
      /**
       * PLAN-05 C4, 2026-08-02 — "בזווית 1 צריך להתקרב עם המצלמה טיפה כי
       * הצמחייה מפריעה לשדה הראייה".
       *
       * The SKP's own Scene put this eye at [0.34, 1.77, 0.79], i.e. plan
       * (34, 79). `fixture-resort-020` — a `plant.potted-2`, 71.25 x 65.7 cm and
       * 240 cm tall — was later baked at plan (40, 80): the camera stood 6 cm
       * from its centre, inside its footprint, at foliage height. It is the
       * corner planter where the two perimeter rows meet, so moving the PLANTER
       * would open a hole in every other angle and in the 2D plan to fix one
       * frame; the camera is the thing that is wrong here.
       *
       * The eye moves 1.00 m along its own view vector (0.8823, 0.4708 in plan)
       * to [1.222, 1.77, 1.261] = plan (122, 126). The TARGET does not move, so
       * the framing is preserved: eye-to-target goes 22.79 m to 21.79 m.
       *
       * Why 1.0 and not the 0.53 m the arithmetic allows, or the 0.5 m rung that
       * photographs clean: at d = 0.5 the planter's box still reaches 2.66 cm in
       * FRONT of the eye and is invisible only because the near plane clips it
       * (0.1 m, Scene3D). That is a silent dependency on an unrelated constant —
       * lower `near` and this angle breaks again with nobody the wiser. At
       * d = 1.0 the whole box sits 47 cm BEHIND the eye and no clipping is
       * involved. Measured ladder and the seven frames: handoff/FOUND-C4.md.
       *
       * ⚠ `position[1]` STAYS 1.77 EXACTLY. `isElevatedAngle` (prompts/refs.ts)
       * asks whether position[1] − target[1] >= 1, and s1 sits at 0.07. Raising
       * the eye would swap s1's materials photograph for the top-down one
       * without a word. The view vector's vertical component is −0.07 m over
       * 22.79, i.e. 3 mm over this move, which is not worth the risk.
       */
      { id: 's1', label: 'זווית 1', position: [1.222, 1.77, 1.261], target: [20.45, 1.7, 11.52], fov: 45 },
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
