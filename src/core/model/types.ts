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
  /**
   * Reflected about its own local x-axis — a real mirror image, not a half turn.
   * A corner bar modelled to stand on the left of a doorway becomes the one that
   * stands on the right, which no rotation can produce.
   *
   * Optional and additive: a scene written before round 4 simply has none, and an
   * unmirrored object still serialises byte-for-byte as it always did, because
   * `mirrorObjects` DELETES the key rather than writing `false`. Same shape as
   * `Attachment.stackedOn`, and for the same reason — no migration.
   *
   * It COMPOSES: `composeTransform` flips a child's local x, negates the angle
   * measured inside the reflection, and XORs the flag down the tree, so a table's
   * chairs, covers and design pieces mirror with it and nothing has to be
   * rewritten on the children themselves.
   *
   * ⚠ It lives on the TRANSFORM and not in `meta` because `replaceObject` resets
   * `meta` when it swaps a non-seated item — a mirror stored there would vanish
   * the moment the user swapped one bar for another.
   */
  mirrored?: boolean
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

/**
 * Per-material-slot overrides; slot names come from the catalog entry.
 *
 * ⚠ THREE STATES, not two, and the picker has to be able to express all of them:
 *
 *  - `textureId: 'fabric-06'` — the user picked that swatch.
 *  - `textureId: null` — the user picked "no texture". The slot wears its plain
 *    baked surface even where the catalogue says otherwise.
 *  - the key ABSENT — the user has not chosen, so the slot's own
 *    `EditableSlot.defaultTexture` decides (and most slots declare none, which is
 *    how the six tables come up on their own white drape).
 *
 * `null` and absent are therefore NOT interchangeable: on the three napkins,
 * which are the only entries carrying a `defaultTexture`, absent means the weave
 * the catalogue chose and `null` means the user took it off. `slotTextureId` in
 * catalog/types.ts is the one place that collapses the three into an answer, and
 * the persisted zod schema (migrations/index.ts) spells the field
 * `.nullable().optional()` for exactly this reason.
 *
 * Additive and optional, so no SCHEMA_VERSION bump: a project written before the
 * picker existed simply has no `textureId` anywhere, which is the ABSENT state
 * and therefore reads as the catalogue default — the behaviour it already had.
 */
export type AppearanceOverrides = Record<string, { color?: string; textureId?: string | null }>

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

/** Shadow-map resolution bucket: 2048 / 4096 / 8192 (viewer3d/LightingRig). */
export type ShadowSharpness = 'soft' | 'medium' | 'sharp'

/** Outdoor lighting: a mode preset plus the sun the user may steer off it. */
export interface LightingSettings {
  mode: LightingMode
  /** degrees clockwise from plan north (-y); where the sun stands */
  sunAzimuth: number
  /** degrees above the horizon */
  sunElevation: number
  sunIntensity: number
  /**
   * Optional, and absent means 'medium' — which resolves to the 4096 that was a
   * fixed constant before this setting existed, so a project saved without it
   * renders exactly what it rendered before.
   */
  shadowSharpness?: ShadowSharpness
  /**
   * PLAN-05 C2 — shadows in the VIEW. Optional, and absent means true: exactly
   * the behaviour that existed before the field did, so a project saved without
   * it opens pixel-identical. Same pattern as `shadowSharpness` above and for
   * the same reason — an optional addition does not move SCHEMA_VERSION.
   *
   * ⚠ It DOES need its own line in the zod schema (core/migrations/index.ts).
   * That object is non-strict, so an undeclared key is stripped on every load
   * and the toggle would appear to reset itself with no error at all.
   *
   * This is a property of the viewport and of the capture sent to the image
   * model — NOT an instruction to render a shadowless picture. See
   * `CAPTURE_SHADOWS_OFF` in core/prompts/templates.ts.
   */
  shadowsEnabled?: boolean
}

/** Sunset seeded from the pre-v5 hardcoded sun so the default render is unchanged. */
export const DEFAULT_LIGHTING: LightingSettings = {
  mode: 'sunset',
  sunAzimuth: 50.6,
  sunElevation: 65.6,
  sunIntensity: 0.9,
}

/**
 * Where the ceremony stands. The resort pack carries TWO `chuppah` rectangles —
 * one in the hall at +0.50 and one on the reception deck at +5.20 — and this
 * picks which of them is live. 'hall' is "חופה למטה", 'reception' is
 * "חופה למעלה"; exactly one of the two exists at a time.
 */
export type ChuppahLocation = 'hall' | 'reception'

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
  /**
   * Which ceremony pad is live. A FACT ABOUT THE EVENT, not a view preference,
   * which is why it lives here and not beside `activeZone` in the view store: it
   * has to travel with the project, survive export/import and be undoable.
   * `activeZone` answers "what am I looking at"; this answers "where is the
   * ceremony". Read it through `core/layout/venueZones.ts` and never straight
   * from here — the default is derived, see below.
   *
   * Optional, and absent does NOT flatly mean 'hall': `chuppahLocationOf` looks
   * at the scene, so a project saved before this field existed with its canopy
   * standing on the DECK's pad opens with the deck live, instead of having that
   * canopy teleported 28 m west by the first edit that re-clamps it. Optional and
   * additive, so SCHEMA_VERSION does not move — the same reasoning as
   * `shadowSharpness`.
   *
   * ⚠ It DOES need its own line in the zod schema (core/migrations/index.ts).
   * `sceneSettings` is a plain z.object, which strips every key it does not
   * declare on every load, so without that line this toggle would work for the
   * session and be gone at the next open, silently and with nothing failing.
   */
  chuppahLocation?: ChuppahLocation
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

export const SCHEMA_VERSION = 13
