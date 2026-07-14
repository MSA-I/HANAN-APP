import { describe, expect, it } from 'vitest'
import { createProject } from '../core/model/factory'
import { SCHEMA_VERSION, migrateAndValidate, runMigrations } from '../core/migrations'
import type { ProjectFile } from './types'

function validFile(): ProjectFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: 'hanan-app',
    savedAt: new Date().toISOString(),
    project: createProject({
      name: 'טסט',
      eventName: 'חתונה',
      eventDate: '2026-08-01',
      venueWidth: 2400,
      venueDepth: 1600,
    }),
  }
}

describe('migrateAndValidate', () => {
  it('accepts a current-version ProjectFile round-trip', () => {
    const file = validFile()
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived).toEqual(file)
    expect(revived.project.scene.venue.size.width).toBe(2400)
  })

  it('rejects garbage', () => {
    expect(() => migrateAndValidate({ nope: true })).toThrow()
    expect(() => migrateAndValidate(null)).toThrow()
    expect(() => migrateAndValidate('not-an-object')).toThrow()
    // right envelope, wrong app tag
    expect(() => migrateAndValidate({ ...validFile(), app: 'other-app' })).toThrow()
  })

  it('rejects a malformed scene object inside the record', () => {
    const file = validFile()
    ;(file.project.scene.objects as Record<string, unknown>).bad = { id: 'bad' }
    expect(() => migrateAndValidate(JSON.parse(JSON.stringify(file)))).toThrow()
  })
})

describe('runMigrations', () => {
  it('upgrades a fake v0 file to v1 via a registered migration', () => {
    const v0 = { app: 'hanan-app', savedAt: 'x', project: {} } // no schemaVersion → treated as v0
    const registry: Record<number, (raw: unknown) => unknown> = {
      0: (raw) => ({ ...(raw as object), schemaVersion: 1, upgraded: true }),
    }
    const out = runMigrations(v0, registry, 1) as { schemaVersion: number; upgraded: boolean }
    expect(out.schemaVersion).toBe(1)
    expect(out.upgraded).toBe(true)
  })

  it('is a no-op when already at the target version', () => {
    const file = validFile()
    expect(runMigrations(file)).toBe(file)
  })

  it('throws when a migration fails to advance the version', () => {
    const registry: Record<number, (raw: unknown) => unknown> = { 0: (raw) => raw }
    expect(() => runMigrations({ schemaVersion: 0 }, registry, 1)).toThrow()
  })
})
