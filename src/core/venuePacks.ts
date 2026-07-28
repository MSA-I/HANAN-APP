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
    // Re-imported 2026-07-28 15:09 from "ריזורט גאמוס - אפליקציה.skp", thirteen
    // hours after the import this file first carried. The origin did NOT move:
    // `offset` and the ZONE_FLOOR bbox (4423×2544) came out identical, so nothing
    // in a saved project shifts. The zones did move, and each one says how below.
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
    // ⚠ Order is load-bearing, not alphabetical: the chuppah and DJ rectangles sit
    // INSIDE the pool one, and VenueLayer draws by descending area while the clamp
    // walks this list — reordering changes which zone wins. Leave it.
    restricted: [
      // 18:03: the single pool marker was SPLIT in two. `pool` is now the water
      // plus its left and top apron (its right edge, 3839, is the water's own),
      // and `saviv` is the surround the user painted as ZONE_SAVIV. The two
      // OVERLAP across x 2579…3839 — a surround is a band and RestrictedZone is a
      // rectangle, so what the extractor can emit is the band's bounding box.
      // What matters downstream is that pool ∪ saviv = 766…3962 × 1408…2544, the
      // old single rectangle exactly: the no-go footprint has not changed, it is
      // only subdivided now so the surround can carry its own rules.
      { x: 766, y: 1408, width: 3073, depth: 1136, label: 'בריכה', kind: 'pool' },
      // The label the user sees comes from `strings.zones.saviv`, which PLAN-02
      // seeded in the same wave; this one is the declared fallback the other zones
      // carry too (VenueLayer.tsx:130). Neither inner zone crosses into this one —
      // the chuppah ends at 2569 and the DJ at exactly 2579, flush against its left
      // edge — so the "chuppah sits inside the pool" arrangement below is untouched.
      //
      // ⚠ It DOES overlap `pool`, and by most of itself: 1260 of its 1383 cm sit
      // inside 766…3839, a good part of that over the water face (889…3839 ×
      // 1611…2544). Only 3839…3962 is clear of the pool. Anything scoped to this
      // zone must decide what it means by it — see PLAN-06's note before wiring
      // `allowedZones`, because the two available mechanisms fail in opposite
      // directions here.
      { x: 2579, y: 1408, width: 1383, depth: 1136, label: 'סביב הבריכה', kind: 'saviv' },
      // 15:09: the bar took 50cm out of the dance floor. Together the two still
      // span y 0…1408 exactly, so only the seam between them moved.
      { x: 1789, y: 0, width: 800, depth: 350, label: 'בר', kind: 'bar' },
      { x: 1789, y: 350, width: 800, depth: 1058, label: 'רחבת ריקודים', kind: 'dancefloor' },
      // 15:09: 233 → 243 deep. That import also carries a SECOND ZONE_DJ face, the
      // same size, 460cm to the left — deliberately NOT added. `kind` is matched as
      // a string and a zone-bound object clamps INTO "its" zone, so two rectangles
      // sharing one kind have no defined target. Keeping x here is what keeps the
      // booth in every saved project where the user left it (BLOCKED-01-A1 §2).
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
      // NEW in the 15:09 import (source doc §29): a 460×1080 strip that opened up
      // beneath the shortened passage, on the east side. The two rings above came
      // out byte-identical, which is what proves the re-extraction did not drift.
      [[3960, 1410], [4420, 1410], [4420, 2490], [3960, 2490]],
    ],
    // Real room contour — no longer the deep L it was: with floorAreas[2] opened
    // up, the east face runs down to y 2490 instead of 1400 and all that is cut
    // out of the rectangle is a 460×50 notch in the south-east corner.
    outline: [[0, 0], [4420, 0], [4420, 2490], [3960, 2490], [3960, 2540], [0, 2540]],
    // Lighting-truss grid: 9 beams along y × 4 along x, all at one level. Read off
    // the 72 `HalfCoupler` clamps in the SKP (72 = 36 crossings × 2), whose centres
    // sit at z = 9.097m with no spread. See Plans/R1/handoff/07-venue-data.md §1.5.
    // Re-measured on the 15:09 import: same 72 clamps, every centre within 4cm of
    // the values below. Left alone — a "correction" would slide a snap grid that
    // already lands on the real beams.
    ceilingBeams: [
      { axis: 'y', positions: [578, 988, 1389, 1798, 2194, 2599, 3011, 3420, 3821], height: 910 },
      { axis: 'x', positions: [190, 550, 904, 1270], height: 910 },
    ],
    // Roof-truss metal, off the venue.glb material `H08_Emerald_Abyss` (no texture —
    // the factor IS the colour). glTF stores baseColorFactor LINEAR, [0.725, 0.635,
    // 0.533]. This is that colour in sRGB, which is what THREE.Color('#…') takes.
    // ⚠ Do NOT "fix" this to #b9a288 — that is the linear triple written out as hex
    // and it renders the beam far too light.
    beamColor: '#ddd1c1',
    // SketchUp Scenes → app three-metres via (x, z, 24.861 − y). Extracted from
    // SimLab Scene nodes (tools flow: SimLab session on the SKP → read Scene N).
    // Cameras do NOT survive the GLB export, so inspect-cameras.mjs reports 0 —
    // the session is the only source. Re-read on the 15:09 import: still 7 Scenes,
    // positions AND directions identical to 4 decimals. Nothing to update here.
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
