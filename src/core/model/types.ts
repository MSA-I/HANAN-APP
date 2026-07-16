/**
 * Shared scene model — the single source of truth interpreted by both the
 * 2D editor (Konva) and the 3D viewer (three.js).
 *
 * Conventions (see core/space.ts — the ONLY place plan↔three mapping lives):
 * - Units: centimeters. Rotation: degrees, clockwise in plan view.
 * - Plan space: x → right, y → down (Konva-native).
 * - An object's front faces -y (up-screen) at rotation 0.
 * - Child transforms are parent-relative; world = compose(parent, local).
 */

export type Id = string

export interface Vec2 {
  x: number
  y: number
}

export interface Size3D {
  width: number
  depth: number
  height: number
}

export interface Transform2D {
  position: Vec2
  rotation: number
  elevation: number
}

export interface Attachment {
  kind: 'seat'
  seatIndex: number
  /** true after the user nudges this chair — the seat reconciler leaves it alone */
  manual: boolean
}

/** Per-material-slot overrides; slot names come from the catalog entry. */
export type AppearanceOverrides = Record<string, { color?: string }>

export interface SeatingConfig {
  enabled: boolean
  chairCatalogId: string
  count: number
  /** cm between chairs along the perimeter (minimum spacing) */
  gap: number
  /** cm from table edge to chair edge */
  offset: number
  /** degrees — where seat 0 sits (round tables) */
  startAngle: number
}

export interface SceneObject {
  id: Id
  catalogId: string
  name: string
  transform: Transform2D
  size: Size3D
  parentId: Id | null
  attachment?: Attachment
  appearance: AppearanceOverrides
  seating?: SeatingConfig
  flags: { locked: boolean; visible: boolean }
  meta: Record<string, string | number | boolean>
}

export interface Venue {
  size: { width: number; depth: number }
  wallHeight: number
  floor: { color: string }
  /** seam for walls/doors/windows/columns/restricted zones (v1.1) */
  elements: never[]
  /** id of a static venue pack (public/venue-packs/<id>/); null = procedural room */
  venuePackId?: string | null
}

export interface SceneSettings {
  /** cm */
  gridSize: number
  snapEnabled: boolean
  showGrid: boolean
  showLabels: boolean
}

export interface SceneState {
  venue: Venue
  objects: Record<Id, SceneObject>
  /**
   * The ONLY z-order authority for TOP-LEVEL objects (parentId === null):
   * draw order in 2D, layers-panel order later. Attached children are not
   * listed here — they render inside their parent's group, ordered by seatIndex.
   */
  objectOrder: Id[]
  settings: SceneSettings
}

export interface Project {
  id: Id
  schemaVersion: number
  name: string
  eventName?: string
  eventDate?: string
  createdAt: string
  updatedAt: string
  scene: SceneState
}

export const SCHEMA_VERSION = 1
