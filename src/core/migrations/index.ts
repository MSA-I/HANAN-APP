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
 * Keyed by the SOURCE version each function upgrades FROM. `migrations[0]`
 * turns a v0 file into a v1 file (and must set `schemaVersion` to 1). Empty
 * for now — v1 is the first shipped schema.
 */
export const migrations: Record<number, (raw: unknown) => unknown> = {}

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

const attachment = z.object({
  kind: z.literal('seat'),
  seatIndex: z.number(),
  manual: z.boolean(),
})

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

const sceneSettings = z.object({
  gridSize: z.number(),
  snapEnabled: z.boolean(),
  showGrid: z.boolean(),
  showLabels: z.boolean(),
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
