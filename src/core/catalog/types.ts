/**
 * Data-driven object catalog. A catalog entry fully describes an object type:
 * its 2D footprint (interpreted by one generic Konva component), its 3D build
 * recipe (interpreted by one generic three.js component), its material slots,
 * resize constraints and seating capability. Adding a furniture type means
 * adding an entry — never touching the renderers.
 */
import type { SeatingConfig, Size3D, Transform2D, Vec2 } from '../model/types'

export type Category = 'tables' | 'seating' | 'bars' | 'tableDecor' | 'decor' | 'structure'

export interface MaterialSlotDef {
  name: string
  /** key into strings.catalog.slots for the UI label */
  labelKey: string
  defaultColor: string
}

export type FootprintPart =
  | { kind: 'circle'; r: number; slot: string }
  | { kind: 'rect'; w: number; h: number; cx?: number; cy?: number; cornerRadius?: number; slot: string }
  /**
   * Annular sector — a slice of a ring, for curved bands (the serpentine table).
   * Plan space is y-down exactly like Konva's, so these map 1:1 onto <Arc>:
   * `startAngle` → its `rotation`, `sweep` → its `angle`, no conversion.
   *
   * `sweep` must be POSITIVE (degrees, clockwise on screen). Konva hands `angle`
   * to canvas `arc()` with counterClockwise=false, so a negative sweep would be
   * drawn as the 360°-minus complement — the whole ring instead of the slice.
   * Producers normalise by moving the start angle back instead.
   *
   * The one part that cannot be faked with what already exists: rect parts carry
   * no rotation, so a curved band tiled out of rects or circles renders as a
   * scalloped caterpillar once ObjectNode strokes every tile.
   */
  | {
      kind: 'arc'
      cx: number
      cy: number
      innerR: number
      outerR: number
      startAngle: number
      sweep: number
      slot: string
    }

export type Outline = { kind: 'circle'; r: number } | { kind: 'rect'; w: number; h: number }

export interface FootprintSpec {
  parts: FootprintPart[]
  /** used for seat layout, snapping bounds and selection */
  outline: Outline
}

export type MeshPart = {
  shape: 'box' | 'cylinder' | 'sphere'
  /** box: [w,h,d] · cylinder: [rTop,rBottom,h] · sphere: [r] — cm */
  dims: number[]
  /** object-local, three convention: [x, elevation, z] where z = plan y — cm */
  offset: [number, number, number]
  slot: string
}

export interface SeatingCapability {
  min: number
  max: number
  defaultCount: number
  defaultChair: string
  defaultGap: number
  defaultOffset: number
}

export interface CatalogEntry {
  id: string
  category: Category
  /** key into strings.catalog.items */
  labelKey: string
  defaultSize: Size3D
  /** initial plan rotation for newly placed instances; existing saved objects are untouched */
  defaultRotation?: number
  resizable: Array<'width' | 'depth' | 'height'>
  minSize: Partial<Size3D>
  maxSize: Partial<Size3D>
  /** round tables etc.: diameter — width and depth stay equal */
  linkWidthDepth?: boolean
  materialSlots: MaterialSlotDef[]
  /** the only material slot the user may recolor; omitted means appearance is fixed */
  editableColorSlot?: string
  footprint: (size: Size3D) => FootprintSpec
  buildMesh: (size: Size3D) => MeshPart[]
  /**
   * URL of a real GLB (public/props/, prepped by glb-prep --mode prop). When set,
   * the 3D viewer renders this model instead of `buildMesh`. When
   * `editableColorSlot` is set, an explicit override tints cloned model materials
   * while preserving their textures and PBR properties. `buildMesh` stays as the
   * loading/error fallback.
   */
  model?: string
  /**
   * URL of a square photo thumbnail (public/thumbs/, 512×512 webp prepped by
   * tools/thumbs-prep.mjs). The library shows it instead of the vector top-view;
   * the SVG footprint stays as the fallback when absent or on image load error.
   */
  thumbnail?: string
  /**
   * Where this object lives. 'floor' (default) = a top-level object on the venue
   * floor. 'surface' = placed ON a table top (attached child, kind 'surface') —
   * it can only be dropped onto a table and is clamped to the table's outline.
   * 'seat' = like 'surface', but dropping it on a table lays one out at EVERY
   * seat instead of one at the pointer (place settings). 'ceiling' = hung from
   * the ceiling: a top-level object whose `elevation` starts at the venue's
   * wallHeight instead of 0.
   *
   * 'floor' and 'ceiling' are top-level objects; 'surface' and 'seat' are
   * attached children that can only be dropped onto a table.
   */
  placement?: 'floor' | 'surface' | 'seat' | 'ceiling'
  /**
   * Fixed-station entries (bar, DJ booth): when the venue pack has a restricted
   * zone of this kind, the object lives ONLY inside that zone — dropping it
   * anywhere snaps it in, and it can never be dragged out. Venues without a
   * matching zone (procedural room) place it freely.
   */
  zoneKind?: string
  seating?: SeatingCapability
  /**
   * Seat placement for a table whose seat line is neither a circle nor a
   * rectangle (the serpentine). When present, `seatsForEntry` uses this instead
   * of the generic `computeSeatTransforms`, and capacity comes from asking for
   * more seats than can fit and counting what comes back — so capacity and
   * placement can never disagree.
   *
   * It is a function here rather than a third `Outline` variant on purpose: a
   * new variant would force new geometry into all nine outline consumers —
   * point-in-S-band, clamp-decor-to-S-band, a THREE.Shape and a Konva selection
   * path among them — and every one of the 40+ existing entries would pay for a
   * shape one table needs. Entries with `seats` still declare a rect `outline`
   * of their bounding box, which is conservative in the safe direction: snapping
   * and venue clamping keep MORE clearance than the real table needs.
   */
  seats?: (seating: SeatingConfig, chair: Size3D) => Transform2D[]
  /** show the name label on canvas by default (tables) */
  labelByDefault?: boolean
}

export function defaultAppearance(entry: CatalogEntry): Record<string, { color?: string }> {
  const out: Record<string, { color?: string }> = {}
  for (const slot of entry.materialSlots) out[slot.name] = { color: slot.defaultColor }
  return out
}

export function slotColor(
  entry: CatalogEntry,
  appearance: Record<string, { color?: string }>,
  slot: string,
): string {
  const fromOverride = appearance[slot]?.color
  if (fromOverride) return fromOverride
  const def = entry.materialSlots.find((s) => s.name === slot)
  return def?.defaultColor ?? '#cccccc'
}

export function anchorOf(_size: Size3D): Vec2 {
  return { x: 0, y: 0 }
}
