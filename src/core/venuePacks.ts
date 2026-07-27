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
    // Re-imported 2026-07-28 from "ריזורט גאמוס - אפליקציה.skp": the passage was
    // shortened and a raised reception deck was marked. The origin did NOT move —
    // every hall zone below is bit-identical to the previous import.
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
    // extracted from ZONE_* marker faces via tools/extract-zones.mjs (plan cm).
    restricted: [
      { x: 766, y: 1408, width: 3196, depth: 1136, label: 'בריכה', kind: 'pool' },
      { x: 1789, y: 0, width: 800, depth: 300, label: 'בר', kind: 'bar' },
      { x: 1789, y: 300, width: 800, depth: 1108, label: 'רחבת ריקודים', kind: 'dancefloor' },
      { x: 2269, y: 1408, width: 310, depth: 233, label: 'עמדת DJ', kind: 'dj' },
      { x: 1809, y: 1651, width: 760, depth: 425, elevation: 50, label: 'חופה', kind: 'chuppah' },
      // was `corridor`/'מסדרון' and 2544 deep — the user shortened it (source doc §34)
      { x: 3962, y: 0, width: 461, depth: 1404, label: 'מעבר', kind: 'passage' },
      // ZONE_KABALAT_PANIM: a RAISED deck (+470cm), detached from the hall floor.
      // Inverted zone — see ALLOWED_IN_KABALAT_PANIM in state/actions.ts: only a
      // chuppah, chairs and buffet tables may be in it, everything else is pushed
      // out (source doc §41).
      { x: 4432, y: 734, width: 1619, depth: 1810, elevation: 470, label: 'קבלת פנים', kind: 'kabalatPanim' },
    ],
    floorAreas: [
      [[0, 0], [1790, 0], [1790, 1410], [770, 1410], [770, 2540], [0, 2540]],
      [[2590, 0], [3960, 0], [3960, 1410], [2590, 1410]],
    ],
    // real room contour — an L, because the passage no longer runs the full depth
    outline: [[0, 0], [4420, 0], [4420, 1400], [3960, 1400], [3960, 2540], [0, 2540]],
    // Lighting-truss grid: 9 beams along y × 4 along x, all at one level. Read off
    // the 72 `HalfCoupler` clamps in the SKP (72 = 36 crossings × 2), whose centres
    // sit at z = 9.097m with no spread. See Plans/handoff/07-venue-data.md §1.5.
    ceilingBeams: [
      { axis: 'y', positions: [578, 988, 1389, 1798, 2194, 2599, 3011, 3420, 3821], height: 910 },
      { axis: 'x', positions: [190, 550, 904, 1270], height: 910 },
    ],
    // SketchUp Scenes → app three-metres via (x, z, 24.861 − y). Extracted from
    // SimLab Scene nodes (tools flow: SimLab session on the SKP → read Scene N).
    // Cameras do NOT survive the GLB export, so inspect-cameras.mjs reports 0 —
    // the session is the only source.
    cameras: [
      { id: 's1', label: 'זווית 1', position: [0.34, 1.77, 0.79], target: [20.45, 1.7, 11.52], fov: 45 },
      { id: 's2', label: 'זווית 2', position: [44.23, 1.6, 0.75], target: [28.71, 1.41, 8.77], fov: 45 },
      { id: 's3', label: 'זווית 3', position: [21.86, 1.55, 0.18], target: [22.22, 1.35, 16.27], fov: 45 },
      { id: 's4', label: 'זווית 4 (מוגבה)', position: [0.09, 6.71, 20.88], target: [20.1, 0.52, 1.99], fov: 45 },
      { id: 's5', label: 'זווית 5 (מוגבה)', position: [45.25, 6.97, 0.6], target: [28.57, 4.34, 10.44], fov: 45 },
      // Scenes 6-7, new in this import. Both stand 1.6m above the 4.70m deck —
      // that eye height is the evidence they are the reception angles (§42).
      { id: 'k1', label: 'קבלת פנים 1', position: [45.24, 6.32, 7.6], target: [54.93, 6.31, 24.45], fov: 45, zone: 'kabalatPanim' },
      { id: 'k2', label: 'קבלת פנים 2', position: [60.01, 6.38, 24.35], target: [45.05, 5.92, 13.92], fov: 45, zone: 'kabalatPanim' },
    ],
  },
]

export function getVenuePack(id: string | null | undefined): VenuePack | undefined {
  if (!id) return undefined
  return VENUE_PACKS.find((p) => p.id === id)
}
