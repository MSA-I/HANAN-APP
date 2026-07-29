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
// type-only import — erased at runtime, so no cycle with catalog/types
import type { Category } from '../catalog/types'

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

export type Attachment =
  | {
      kind: 'seat'
      seatIndex: number
      /** true after the user nudges this chair — the seat reconciler leaves it alone */
      manual: boolean
    }
  /** decor standing ON the parent's top surface; local elevation = parent height */
  | {
      kind: 'surface'
      /**
       * Standing on the FLOOR through the open centre of a ring table, not on its
       * top — a tall arrangement rising through the hole (source doc §48).
       *
       * A modifier rather than a third `kind` for the same reason `Outline.circle`
       * grew `rInner` instead of a `'ring'` variant: the relationship to the parent
       * is identical (moves with it, deleted with it, drilled into the same way),
       * so every consumer that asks "is this surface decor" keeps its answer. Only
       * the clamp region and the elevation differ.
       *
       * Set once, at drop. Dragging never flips it, so nothing ever falls 75 cm
       * mid-gesture: a top item is pushed out of the hole, a hole item is held in.
       */
      inHole?: boolean
      /**
       * This item stands on ANOTHER surface item of the same table rather than
       * on the bare top — a folded napkin on its place setting (source doc §27).
       * It tracks that item's position and dies with it. Optional and additive,
       * so no schema bump: a scene written before it simply has none.
       */
      stackedOn?: Id
    }

/** Children sort: chairs by seat index, surface decor after them (stable). */
export function childSortKey(o: { attachment?: Attachment }): number {
  return o.attachment?.kind === 'seat' ? o.attachment.seatIndex : Number.MAX_SAFE_INTEGER
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
  /**
   * `locked` is a user toggle — the Inspector can turn it off again. `frozen` is
   * not: it marks a baked venue fixture (core/venueFixtures.ts) that must never
   * move, be deleted or be unlocked, and no UI writes it. See bake-plugin.ts.
   */
  flags: { locked: boolean; visible: boolean; frozen?: boolean }
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

/** Per-category layer state; a missing key means visible + unlocked. */
export interface LayerFlags {
  hidden?: boolean
  locked?: boolean
}

export type LightingMode = 'day' | 'sunset' | 'night'

/** Outdoor lighting: a mode preset plus the sun the user may steer off it. */
export interface LightingSettings {
  mode: LightingMode
  /** degrees clockwise from plan north (-y); where the sun stands */
  sunAzimuth: number
  /** degrees above the horizon */
  sunElevation: number
  sunIntensity: number
}

/** Sunset seeded from the pre-v5 hardcoded sun so the default render is unchanged. */
export const DEFAULT_LIGHTING: LightingSettings = {
  mode: 'sunset',
  sunAzimuth: 50.6,
  sunElevation: 65.6,
  sunIntensity: 0.9,
}

export interface SceneSettings {
  /** cm */
  gridSize: number
  snapEnabled: boolean
  showGrid: boolean
  showLabels: boolean
  /** category layers (schema v4); optional so pre-v4 data parses — factory + migration materialize {} */
  layers?: Partial<Record<Category, LayerFlags>>
  /** outdoor lighting (schema v5); optional so pre-v5 data parses — read via lightingOf() */
  lighting?: LightingSettings
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

export const SCHEMA_VERSION = 11
