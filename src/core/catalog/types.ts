/**
 * Data-driven object catalog. A catalog entry fully describes an object type:
 * its 2D footprint (interpreted by one generic Konva component), its 3D build
 * recipe (interpreted by one generic three.js component), its material slots,
 * resize constraints and seating capability. Adding a furniture type means
 * adding an entry — never touching the renderers.
 */
import type { Size3D, Vec2 } from '../model/types'

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
  resizable: Array<'width' | 'depth' | 'height'>
  minSize: Partial<Size3D>
  maxSize: Partial<Size3D>
  /** round tables etc.: diameter — width and depth stay equal */
  linkWidthDepth?: boolean
  materialSlots: MaterialSlotDef[]
  footprint: (size: Size3D) => FootprintSpec
  buildMesh: (size: Size3D) => MeshPart[]
  /**
   * URL of a real GLB (public/props/, prepped by glb-prep --mode prop). When set,
   * the 3D viewer renders this model instead of `buildMesh` — its materials are
   * baked, so `materialSlots` colours no longer apply in 3D (they still drive the
   * 2D footprint). `buildMesh` stays as the loading/error fallback.
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
   */
  placement?: 'floor' | 'surface'
  /**
   * Fixed-station entries (bar, DJ booth): when the venue pack has a restricted
   * zone of this kind, the object lives ONLY inside that zone — dropping it
   * anywhere snaps it in, and it can never be dragged out. Venues without a
   * matching zone (procedural room) place it freely.
   */
  zoneKind?: string
  seating?: SeatingCapability
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
