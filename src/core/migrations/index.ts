/**
 * Schema migration + validation for persisted project files.
 *
 * A stored file may have been written by an older build. `migrateAndValidate`
 * upgrades a raw value through every pending migration and then validates the
 * result against a zod schema mirroring the model types. This runs on every
 * repository read and on JSON import, so corrupt or foreign data is rejected
 * at the boundary rather than crashing the editor downstream.
 */
import { z } from 'zod'
import { SCHEMA_VERSION } from '../model/types'
import type { ProjectFile } from '../../persistence/types'

export { SCHEMA_VERSION }

/**
 * v1 → v2: the generic starter catalog was replaced by the venue's real inventory
 * (phase 2.5), so several catalog ids no longer exist. `getCatalogEntry` throws on
 * an unknown id, which would make an old project unopenable — remap them onto the
 * closest real item instead. Sizes are left alone: an object keeps its stored size,
 * and the GLB is fitted to it.
 */
const CATALOG_ID_V2: Record<string, string> = {
  // the two placeholder chairs → the house chair (white crossback)
  'chair.banquet': 'chair.x-white',
  'chair.chiavari': 'chair.x-white',
  // tables with no real counterpart → the nearest real one
  'table.rect': 'table.banquet',
  'table.cocktail': 'table.round',
}

function remapCatalogIds(raw: unknown): unknown {
  const file = raw as {
    project?: { scene?: { objects?: Record<string, { catalogId?: string; seating?: { chairCatalogId?: string } }> } }
  }
  const objects = file?.project?.scene?.objects
  if (objects) {
    for (const obj of Object.values(objects)) {
      const mapped = obj.catalogId ? CATALOG_ID_V2[obj.catalogId] : undefined
      if (mapped) obj.catalogId = mapped
      const chair = obj.seating?.chairCatalogId ? CATALOG_ID_V2[obj.seating.chairCatalogId] : undefined
      if (chair && obj.seating) obj.seating.chairCatalogId = chair
    }
  }
  return { ...(raw as object), schemaVersion: 2, project: { ...file.project, schemaVersion: 2 } }
}

/**
 * v2 → v3: the attachment format gained a second kind ('surface' — decor standing
 * on a table top). Existing v2 data is already valid v3, so this is a pure
 * version bump that marks the file as written by a surface-aware build.
 */
function bumpToV3(raw: unknown): unknown {
  const file = raw as { project?: object }
  return { ...(raw as object), schemaVersion: 3, project: { ...file.project, schemaVersion: 3 } }
}

/**
 * v3 → v4: the "staging" catalog category was removed — the venue pack itself
 * provides the fixed stage/dance-floor, so placed `stage.platform` and
 * `dancefloor.rect` objects are deleted (plus any children orphaned by that).
 * Also introduces `settings.layers` (per-category show/lock), defaulted to {}.
 */
const REMOVED_CATALOG_IDS_V4 = new Set(['stage.platform', 'dancefloor.rect'])

function dropStagingAndAddLayers(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        objects?: Record<string, { catalogId?: string; parentId?: string | null }>
        objectOrder?: string[]
        settings?: { layers?: unknown }
      }
    }
  }
  const scene = file?.project?.scene
  const objects = scene?.objects
  if (objects) {
    for (const [id, obj] of Object.entries(objects)) {
      if (obj.catalogId && REMOVED_CATALOG_IDS_V4.has(obj.catalogId)) delete objects[id]
    }
    // orphan sweep to fixpoint — drop children whose parent chain was deleted
    let changed = true
    while (changed) {
      changed = false
      for (const [id, obj] of Object.entries(objects)) {
        if (obj.parentId && !(obj.parentId in objects)) {
          delete objects[id]
          changed = true
        }
      }
    }
    if (Array.isArray(scene.objectOrder)) {
      scene.objectOrder = scene.objectOrder.filter((id) => id in objects)
    }
  }
  if (scene?.settings) scene.settings.layers ??= {}
  return { ...(raw as object), schemaVersion: 4, project: { ...file.project, schemaVersion: 4 } }
}

/**
 * v4 → v5: ceiling items in the resort pack used to hang from the roof apex
 * (wallHeight 1160); they now hang from the lighting-truss pipe level. Re-pin
 * every stored hung object's TOP to that anchor. Constants are frozen at the
 * values this migration shipped with — the live pack config may drift later.
 */
const RESORT_HANG_HEIGHT_V5 = 895
const CEILING_CATALOG_IDS_V5 = new Set([
  'lamp.pendant',
  'lamp.pendant-cluster',
  'lamp.chandelier-diamond',
  'lamp.chandelier-basket',
  'lamp.chandelier-candelabra',
])

function repinCeilingToTruss(raw: unknown): unknown {
  const file = raw as {
    project?: {
      scene?: {
        venue?: { venuePackId?: string | null }
        objects?: Record<string, { catalogId?: string; transform?: { elevation?: number }; size?: { height?: number } }>
      }
    }
  }
  const scene = file?.project?.scene
  if (scene?.venue?.venuePackId === 'resort' && scene.objects) {
    for (const obj of Object.values(scene.objects)) {
      if (!obj.catalogId || !CEILING_CATALOG_IDS_V5.has(obj.catalogId)) continue
      if (!obj.transform || typeof obj.size?.height !== 'number') continue
      obj.transform.elevation = RESORT_HANG_HEIGHT_V5 - obj.size.height
    }
  }
  return { ...(raw as object), schemaVersion: 5, project: { ...file.project, schemaVersion: 5 } }
}

/**
 * Keyed by the SOURCE version each function upgrades FROM. `migrations[0]`
 * turns a v0 file into a v1 file (and must set `schemaVersion` to 1).
 */
export const migrations: Record<number, (raw: unknown) => unknown> = {
  1: remapCatalogIds,
  2: bumpToV3,
  3: dropStagingAndAddLayers,
  4: repinCeilingToTruss,
}

function schemaVersionOf(raw: unknown): number {
  if (raw && typeof raw === 'object' && 'schemaVersion' in raw) {
    const v = (raw as { schemaVersion: unknown }).schemaVersion
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return 0
}

/**
 * Pure, testable migration runner: applies migrations from the file's current
 * version up towards `target`, stopping when no migration is registered for the
 * current version. Each migration MUST advance the version or we throw rather
 * than loop forever.
 */
export function runMigrations(
  raw: unknown,
  registry: Record<number, (raw: unknown) => unknown> = migrations,
  target: number = SCHEMA_VERSION,
): unknown {
  let current = raw
  let version = schemaVersionOf(current)
  while (version < target) {
    const migrate = registry[version]
    if (!migrate) break
    const next = migrate(current)
    const nextVersion = schemaVersionOf(next)
    if (nextVersion <= version) {
      throw new Error(`Migration from schema v${version} did not advance the version`)
    }
    current = next
    version = nextVersion
  }
  return current
}

// --- zod schema (mirrors src/core/model/types.ts) --------------------------

const vec2 = z.object({ x: z.number(), y: z.number() })

const size3d = z.object({
  width: z.number(),
  depth: z.number(),
  height: z.number(),
})

const transform2d = z.object({
  position: vec2,
  rotation: z.number(),
  elevation: z.number(),
})

const attachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('seat'),
    seatIndex: z.number(),
    manual: z.boolean(),
  }),
  z.object({ kind: z.literal('surface') }),
])

const appearance = z.record(z.object({ color: z.string().optional() }))

const seatingConfig = z.object({
  enabled: z.boolean(),
  chairCatalogId: z.string(),
  count: z.number(),
  gap: z.number(),
  offset: z.number(),
  startAngle: z.number(),
})

// meta values are validated loosely — arbitrary primitive tags are allowed.
const meta = z.record(z.union([z.string(), z.number(), z.boolean()]))

const sceneObject = z.object({
  id: z.string(),
  catalogId: z.string(),
  name: z.string(),
  transform: transform2d,
  size: size3d,
  parentId: z.string().nullable(),
  attachment: attachment.optional(),
  appearance,
  seating: seatingConfig.optional(),
  flags: z.object({ locked: z.boolean(), visible: z.boolean() }),
  meta,
})

const venue = z.object({
  size: z.object({ width: z.number(), depth: z.number() }),
  wallHeight: z.number(),
  floor: z.object({ color: z.string() }),
  elements: z.array(z.never()),
  // optional — old projects have none (procedural room). nullish so it survives load.
  venuePackId: z.string().nullish(),
})

const layerFlags = z.object({ hidden: z.boolean().optional(), locked: z.boolean().optional() })

const sceneSettings = z.object({
  gridSize: z.number(),
  snapEnabled: z.boolean(),
  showGrid: z.boolean(),
  showLabels: z.boolean(),
  // v4 category layers. String-keyed on purpose: a stale category key (e.g. a
  // removed 'staging') must never brick a load. Optional so pre-v4 files parse;
  // the v4 migration + factory materialize {}.
  layers: z.record(layerFlags).optional(),
})

const sceneState = z.object({
  venue,
  objects: z.record(sceneObject),
  objectOrder: z.array(z.string()),
  settings: sceneSettings,
})

const project = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  name: z.string(),
  eventName: z.string().optional(),
  eventDate: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  scene: sceneState,
})

export const projectFileSchema = z.object({
  schemaVersion: z.number(),
  app: z.literal('hanan-app'),
  savedAt: z.string(),
  project,
})

/** Upgrade a raw stored/imported value and validate it. Throws on garbage. */
export function migrateAndValidate(raw: unknown): ProjectFile {
  const migrated = runMigrations(raw)
  return projectFileSchema.parse(migrated) as ProjectFile
}
