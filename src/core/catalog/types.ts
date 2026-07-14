/**
 * Data-driven object catalog. A catalog entry fully describes an object type:
 * its 2D footprint (interpreted by one generic Konva component), its 3D build
 * recipe (interpreted by one generic three.js component), its material slots,
 * resize constraints and seating capability. Adding a furniture type means
 * adding an entry — never touching the renderers.
 */
import type { Size3D, Vec2 } from '../model/types'

export type Category = 'tables' | 'seating' | 'staging' | 'bars' | 'decor' | 'structure'

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
