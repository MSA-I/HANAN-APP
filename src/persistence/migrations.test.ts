import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
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

describe('v1 → v2 catalog remap', () => {
  /** A v1 file holding two items whose catalog ids no longer exist. */
  function v1FileWithRetiredIds() {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: { objects: Record<string, unknown>; objectOrder: string[] }
    }
    file.schemaVersion = 1
    project.schemaVersion = 1
    project.scene.objects = {
      t1: {
        id: 't1',
        catalogId: 'table.cocktail',
        name: 'קוקטייל',
        transform: { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 },
        size: { width: 70, depth: 70, height: 110 },
        parentId: null,
        appearance: {},
        seating: { enabled: true, chairCatalogId: 'chair.chiavari', count: 4, gap: 10, offset: 6, startAngle: 0 },
        flags: { locked: false, visible: true },
        meta: {},
      },
      t2: {
        id: 't2',
        catalogId: 'table.rect',
        name: 'מלבני',
        transform: { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 },
        size: { width: 180, depth: 90, height: 75 },
        parentId: null,
        appearance: {},
        flags: { locked: false, visible: true },
        meta: {},
      },
    }
    project.scene.objectOrder = ['t1', 't2']
    return file
  }

  it('remaps retired catalog ids — including a table s chair — and advances the version', () => {
    const revived = migrateAndValidate(v1FileWithRetiredIds())
    const objects = revived.project.scene.objects
    expect(objects.t1.catalogId).toBe('table.round')
    expect(objects.t2.catalogId).toBe('table.banquet')
    expect(objects.t1.seating?.chairCatalogId).toBe('chair.x-white')
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('every id the migration can produce actually exists in the catalog', () => {
    // the point of the migration: a stored project must never reach getCatalogEntry
    // with an id it will throw on.
    const revived = migrateAndValidate(v1FileWithRetiredIds())
    for (const obj of Object.values(revived.project.scene.objects)) {
      expect(() => getCatalogEntry(obj.catalogId)).not.toThrow()
      if (obj.seating) expect(() => getCatalogEntry(obj.seating!.chairCatalogId)).not.toThrow()
    }
  })
})

describe('v2 → v3 surface attachments', () => {
  it('bumps a v2 file to the current version unchanged', () => {
    const file = validFile() as unknown as { schemaVersion: number; project: { schemaVersion: number } }
    file.schemaVersion = 2
    file.project.schemaVersion = 2
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('accepts a scene holding table-top decor (kind surface)', () => {
    const file = validFile()
    const objects = file.project.scene.objects as Record<string, unknown>
    objects.t1 = {
      id: 't1',
      catalogId: 'table.round',
      name: '',
      transform: { position: { x: 500, y: 500 }, rotation: 0, elevation: 0 },
      size: { width: 180, depth: 180, height: 75 },
      parentId: null,
      appearance: {},
      flags: { locked: false, visible: true },
      meta: {},
    }
    objects.d1 = {
      id: 'd1',
      catalogId: 'decor.candlestick-brass',
      name: '',
      transform: { position: { x: 10, y: 5 }, rotation: 0, elevation: 75 },
      size: { width: 21.4, depth: 21.4, height: 35 },
      parentId: 't1',
      attachment: { kind: 'surface' },
      appearance: {},
      flags: { locked: false, visible: true },
      meta: {},
    }
    file.project.scene.objectOrder = ['t1']
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.objects.d1.attachment).toEqual({ kind: 'surface' })
  })
})

describe('v3 → v4 staging removal + layers', () => {
  /** A v3 file holding a stage, a dance floor (both retired), a table and a child of the stage. */
  function v3FileWithStaging() {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: {
        objects: Record<string, unknown>
        objectOrder: string[]
        settings: Record<string, unknown>
      }
    }
    file.schemaVersion = 3
    project.schemaVersion = 3
    // pre-v4 files have no layers key
    delete project.scene.settings.layers
    const base = {
      transform: { position: { x: 500, y: 500 }, rotation: 0, elevation: 0 },
      parentId: null,
      appearance: {},
      flags: { locked: false, visible: true },
      meta: {},
    }
    project.scene.objects = {
      s1: { ...base, id: 's1', catalogId: 'stage.platform', name: 'במה', size: { width: 400, depth: 300, height: 60 } },
      d1: { ...base, id: 'd1', catalogId: 'dancefloor.rect', name: 'רחבה', size: { width: 400, depth: 400, height: 3 } },
      t1: { ...base, id: 't1', catalogId: 'table.round', name: '', size: { width: 180, depth: 180, height: 75 } },
      g1: {
        ...base,
        id: 'g1',
        catalogId: 'decor.candlestick-brass',
        name: '',
        size: { width: 21.4, depth: 21.4, height: 35 },
        parentId: 's1',
        attachment: { kind: 'surface' },
        transform: { position: { x: 0, y: 0 }, rotation: 0, elevation: 60 },
      },
    }
    project.scene.objectOrder = ['s1', 'd1', 't1']
    return file
  }

  it('deletes placed stage/dance-floor objects, their children and their order entries', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v3FileWithStaging())))
    const objects = revived.project.scene.objects
    expect(objects.s1).toBeUndefined()
    expect(objects.d1).toBeUndefined()
    expect(objects.g1).toBeUndefined()
    expect(objects.t1).toBeDefined()
    expect(revived.project.scene.objectOrder).toEqual(['t1'])
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
    // the layers field is materialized by the migration and survives zod validation
    expect(revived.project.scene.settings.layers).toEqual({})
    // no surviving id may throw in the catalog
    for (const obj of Object.values(revived.project.scene.objects)) {
      expect(() => getCatalogEntry(obj.catalogId)).not.toThrow()
    }
  })

  it('a v3 file without staging objects gets a pure bump plus empty layers', () => {
    const file = validFile() as unknown as {
      schemaVersion: number
      project: { schemaVersion: number; scene: { settings: Record<string, unknown> } }
    }
    file.schemaVersion = 3
    file.project.schemaVersion = 3
    delete file.project.scene.settings.layers
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.scene.settings.layers).toEqual({})
  })
})

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
