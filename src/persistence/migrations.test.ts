import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, getCatalogEntry } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { hangRange } from '../core/layout/beams'
import { createProject } from '../core/model/factory'
import { SCHEMA_VERSION, migrateAndValidate, migrations, runMigrations } from '../core/migrations'
import { getVenuePack } from '../core/venuePacks'
import { isLayerHidden, isLayerLocked } from '../state/selectors'
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

describe('v4 → v5 ceiling re-pin to truss', () => {
  const hang = (elevation: number, height: number) => ({
    id: 'c1',
    catalogId: 'lamp.chandelier-diamond',
    name: '',
    transform: { position: { x: 500, y: 500 }, rotation: 0, elevation },
    size: { width: 48.1, depth: 48.2, height },
    parentId: null,
    appearance: {},
    flags: { locked: false, visible: true },
    meta: {},
  })

  function v4File(venuePackId?: string) {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: { venue: { venuePackId?: string }; objects: Record<string, unknown>; objectOrder: string[] }
    }
    file.schemaVersion = 4
    project.schemaVersion = 4
    if (venuePackId) project.scene.venue.venuePackId = venuePackId
    // chandelier hung from the old roof-apex anchor (1160 − 90)
    project.scene.objects = { c1: hang(1070, 90) }
    project.scene.objectOrder = ['c1']
    return file
  }

  it('re-pins a resort chandelier from the roof apex to the truss (895)', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v4File('resort'))))
    expect(revived.project.scene.objects.c1.transform.elevation).toBe(895 - 90)
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves a procedural-room chandelier alone', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v4File())))
    expect(revived.project.scene.objects.c1.transform.elevation).toBe(1070)
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('v5 → v6 category layer rename', () => {
  /**
   * Read layers as a plain string map: the model types them by Category, but the
   * whole point here is what happens to keys that are NO LONGER categories.
   */
  const layersOf = (file: ProjectFile) =>
    file.project.scene.settings.layers as unknown as Record<string, { hidden?: boolean; locked?: boolean }>

  /** A v5 file whose layers hold whatever the caller set. */
  function v5FileWithLayers(layers: Record<string, { hidden?: boolean; locked?: boolean }>) {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: { settings: Record<string, unknown> }
    }
    file.schemaVersion = 5
    project.schemaVersion = 5
    project.scene.settings.layers = layers
    return JSON.parse(JSON.stringify(file))
  }

  it('renames the retired structure layer onto chuppah', () => {
    const revived = migrateAndValidate(v5FileWithLayers({ structure: { hidden: true, locked: true } }))
    const layers = layersOf(revived)
    expect(layers.structure).toBeUndefined()
    expect(layers.chuppah).toEqual({ hidden: true, locked: true })
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('gives each split-off category the state of the layer it left', () => {
    const revived = migrateAndValidate(
      v5FileWithLayers({
        decor: { hidden: true },
        tableDecor: { locked: true },
        seating: { hidden: true, locked: true },
      }),
    )
    const layers = layersOf(revived)
    // the source layers keep their own state...
    expect(layers.decor).toEqual({ hidden: true })
    expect(layers.tableDecor).toEqual({ locked: true })
    expect(layers.seating).toEqual({ hidden: true, locked: true })
    // ...and the categories carved out of them inherit it
    expect(layers.lighting).toEqual({ hidden: true })
    expect(layers.tableware).toEqual({ locked: true })
    expect(layers.bridalChair).toEqual({ hidden: true, locked: true })
  })

  it('creates nothing for absent or all-off layers', () => {
    const revived = migrateAndValidate(v5FileWithLayers({ structure: {}, decor: { hidden: false } }))
    const layers = layersOf(revived)
    expect(layers).toEqual({ decor: { hidden: false } })
  })

  it('leaves a v5 file with no layers key untouched apart from the version', () => {
    const file = validFile() as unknown as {
      schemaVersion: number
      project: { schemaVersion: number; scene: { settings: Record<string, unknown> } }
    }
    file.schemaVersion = 5
    file.project.schemaVersion = 5
    delete file.project.scene.settings.layers
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.settings.layers).toBeUndefined()
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('every category the migration can write is a real catalog category', () => {
    const revived = migrateAndValidate(
      v5FileWithLayers({
        structure: { hidden: true },
        decor: { hidden: true },
        tableDecor: { hidden: true },
        seating: { hidden: true },
      }),
    )
    for (const key of Object.keys(revived.project.scene.settings.layers!)) {
      expect(CATEGORY_ORDER).toContain(key)
    }
  })
})

describe('v6 → v7 resort re-import', () => {
  /** A v6 file with furniture parked at the old plan's far edges. */
  function v6File(venuePackId?: string) {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: {
        venue: { venuePackId?: string; size: { width: number; depth: number }; wallHeight: number }
        objects: Record<string, unknown>
        objectOrder: string[]
      }
    }
    file.schemaVersion = 6
    project.schemaVersion = 6
    if (venuePackId) project.scene.venue.venuePackId = venuePackId
    // what a resort project stored before the re-import
    project.scene.venue.size = { width: 4423, depth: 2544 }
    project.scene.venue.wallHeight = 1160
    const base = {
      parentId: null,
      appearance: {},
      flags: { locked: false, visible: true },
      meta: {},
      size: { width: 180, depth: 180, height: 75 },
      name: '',
      catalogId: 'table.round',
    }
    project.scene.objects = {
      // hard against the old right edge, and inside the stretch of the old
      // corridor that the shortened passage gave back
      t1: { ...base, id: 't1', transform: { position: { x: 4300, y: 2400 }, rotation: 0, elevation: 0 } },
      t2: { ...base, id: 't2', transform: { position: { x: 100, y: 100 }, rotation: 0, elevation: 0 } },
    }
    project.scene.objectOrder = ['t1', 't2']
    return file
  }

  it('widens a stored resort venue to the re-imported plan', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v6File('resort'))))
    expect(revived.project.scene.venue.size).toEqual({ width: 6051, depth: 2544 })
    expect(revived.project.scene.venue.wallHeight).toBe(1160)
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves every stored object inside the migrated bounds', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v6File('resort'))))
    const { width, depth } = revived.project.scene.venue.size
    for (const obj of Object.values(revived.project.scene.objects)) {
      const { x, y } = obj.transform.position
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(width)
      expect(y).toBeLessThanOrEqual(depth)
    }
  })

  it('the migrated size matches the live pack, so nothing is clamped away', () => {
    // the guard on the "no re-clamp needed" reasoning: it only holds while the
    // migration's frozen size is not SMALLER than the pack the editor clamps to.
    const pack = getVenuePack('resort')!
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v6File('resort'))))
    expect(revived.project.scene.venue.size.width).toBeLessThanOrEqual(pack.size.width)
    expect(revived.project.scene.venue.size.depth).toBeLessThanOrEqual(pack.size.depth)
  })

  it('leaves a procedural-room project alone', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v6File())))
    expect(revived.project.scene.venue.size).toEqual({ width: 4423, depth: 2544 })
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
  })
})

describe('v7 → v8 layout tag split', () => {
  /** A v7 file with an applied hall layout and a table design on one table. */
  function v7File() {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as {
      schemaVersion: number
      scene: { objects: Record<string, unknown>; objectOrder: string[] }
    }
    file.schemaVersion = 7
    project.schemaVersion = 7
    const base = {
      parentId: null,
      appearance: {},
      flags: { locked: false, visible: true },
      size: { width: 180, depth: 180, height: 75 },
      name: '',
      catalogId: 'table.round',
      transform: { position: { x: 400, y: 400 }, rotation: 0, elevation: 0 },
    }
    project.scene.objects = {
      t1: { ...base, id: 't1', meta: { layout: 'layout.rounds-classic', number: 1 } },
      t2: { ...base, id: 't2', meta: { number: 2 } },
      d1: {
        ...base,
        id: 'd1',
        parentId: 't1',
        attachment: { kind: 'surface' },
        catalogId: 'decor.candlestick-gold',
        size: { width: 10, depth: 10, height: 30 },
        meta: { design: 'design.classic-gold' },
      },
    }
    project.scene.objectOrder = ['t1', 't2']
    return file
  }

  it('moves meta.layout onto its own key so lighting can use a second one', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v7File())))
    const objects = revived.project.scene.objects
    expect(objects.t1.meta.layoutTables).toBe('layout.rounds-classic')
    expect(objects.t1.meta.layout).toBeUndefined()
    expect(objects.t1.meta.number).toBe(1)
    expect(objects.t2.meta).toEqual({ number: 2 })
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves meta.design alone — a table design was already its own slot', () => {
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(v7File())))
    expect(revived.project.scene.objects.d1.meta.design).toBe('design.classic-gold')
    expect(revived.project.scene.objects.d1.meta.layoutTables).toBeUndefined()
  })

  it('validates the v8 frozen flag and still accepts objects without it', () => {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as { scene: { objects: Record<string, unknown>; objectOrder: string[] } }
    project.scene.objects = {
      f1: {
        id: 'f1',
        catalogId: 'bar.resort-left',
        name: '',
        transform: { position: { x: 300, y: 300 }, rotation: 0, elevation: 0 },
        size: { width: 200, depth: 60, height: 110 },
        parentId: null,
        appearance: {},
        flags: { locked: true, visible: true, frozen: true },
        meta: { fixture: true },
      },
    }
    project.scene.objectOrder = ['f1']
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.objects.f1.flags.frozen).toBe(true)
  })
})

describe('v8 → v9 new categories, stacked napkins, hang re-clamp', () => {
  /** The three categories v9 adds. Asserted against the catalog below, not assumed. */
  const NEW_V9_CATEGORIES: Category[] = ['tableDesigns', 'ringCenter', 'chuppahDecor']

  const base = {
    name: '',
    parentId: null as string | null,
    appearance: {},
    flags: { locked: false, visible: true },
    meta: {},
  }

  function v8File(): Record<string, unknown> {
    const file = validFile() as unknown as Record<string, unknown>
    const project = file.project as { schemaVersion: number }
    file.schemaVersion = 8
    project.schemaVersion = 8
    return file
  }

  /**
   * A v8 scene as the app itself writes one: a round table, a place setting on it,
   * and a napkin standing ON that setting. The napkin's `stackedOn` is the field
   * the zod schema used to strip on every load.
   */
  function v8FileWithStackedNapkin() {
    const file = v8File()
    const project = file.project as {
      scene: { objects: Record<string, unknown>; objectOrder: string[] }
    }
    const table = getCatalogEntry('table.round')
    const setting = getCatalogEntry('decor.place-setting')
    const napkin = getCatalogEntry('decor.napkin-white')
    project.scene.objects = {
      t1: {
        ...base,
        id: 't1',
        catalogId: table.id,
        size: { ...table.defaultSize },
        transform: { position: { x: 500, y: 500 }, rotation: 0, elevation: 0 },
      },
      p1: {
        ...base,
        id: 'p1',
        catalogId: setting.id,
        size: { ...setting.defaultSize },
        parentId: 't1',
        attachment: { kind: 'surface' },
        transform: { position: { x: 0, y: -60 }, rotation: 0, elevation: table.defaultSize.height },
      },
      n1: {
        ...base,
        id: 'n1',
        catalogId: napkin.id,
        size: { ...napkin.defaultSize },
        parentId: 't1',
        // the whole point of this fixture
        attachment: { kind: 'surface', stackedOn: 'p1' },
        transform: {
          position: { x: 0, y: -60 },
          rotation: 0,
          elevation: table.defaultSize.height + setting.defaultSize.height,
        },
      },
      h1: {
        ...base,
        id: 'h1',
        catalogId: 'decor.vase-pampas',
        size: { ...getCatalogEntry('decor.vase-pampas').defaultSize },
        parentId: 't1',
        // the OTHER surface modifier, so the fix cannot have traded one for the other
        attachment: { kind: 'surface', inHole: true },
        transform: { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 },
      },
    }
    project.scene.objectOrder = ['t1']
    return JSON.parse(JSON.stringify(file))
  }

  it('keeps a napkin pinned to the place setting it stands on', () => {
    // Regression: the zod `surface` member declared only `inHole`, and a zod object
    // STRIPS undeclared keys rather than rejecting them — so every napkin came back
    // orphaned and deleteWithStack found no riders. This fails without the fix.
    const revived = migrateAndValidate(v8FileWithStackedNapkin())
    expect(revived.project.scene.objects.n1.attachment).toEqual({ kind: 'surface', stackedOn: 'p1' })
    // and the host it names still exists, which is what makes the pin meaningful
    expect(revived.project.scene.objects.p1).toBeDefined()
  })

  it('keeps the other surface modifier too', () => {
    const revived = migrateAndValidate(v8FileWithStackedNapkin())
    expect(revived.project.scene.objects.h1.attachment).toEqual({ kind: 'surface', inHole: true })
  })

  it('advances a v8 file to the current version', () => {
    const revived = migrateAndValidate(v8FileWithStackedNapkin())
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves no gap in the migration chain', () => {
    // This replaces an `expect(SCHEMA_VERSION).toBe(10)` that stood here and had to
    // be edited on the v11 bump — a frozen number is not a property, it is a
    // reminder that fires late (BRIEF §1.7). The property it was reaching for is
    // that the chain is UNBROKEN: `runMigrations` stops silently at the first
    // version with no function registered, so a bump with a missing step would
    // leave every stored file a version behind and still "pass" a load.
    for (let v = 1; v < SCHEMA_VERSION; v++) expect(migrations[v]).toBeTypeOf('function')
  })

  it('adds the three new categories to the catalog order', () => {
    for (const category of NEW_V9_CATEGORIES) expect(CATEGORY_ORDER).toContain(category)
  })

  it('writes NO layer entry for the new categories — absent already means visible and unlocked', () => {
    // This is the migration's documented no-op, asserted as BEHAVIOUR rather than as
    // a missing key: setLayerFlag deletes an entry once both flags are off, so a
    // seeded {} would be a state the app erases on the first toggle.
    const file = v8File()
    const project = file.project as { scene: { settings: Record<string, unknown> } }
    project.scene.settings.layers = { tableDecor: { hidden: true } }
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    const layers = revived.project.scene.settings.layers!
    for (const category of NEW_V9_CATEGORIES) {
      expect(layers[category]).toBeUndefined()
      expect(isLayerHidden(revived.project.scene, category)).toBe(false)
      expect(isLayerLocked(revived.project.scene, category)).toBe(false)
    }
    // and the layer nothing was carved out of keeps exactly its own state
    expect(layers.tableDecor).toEqual({ hidden: true })
  })

  it('moves no stored object between categories while gate 2 is open', () => {
    // Gate 2: source doc line 75 says some tableDecor items moved into tableDesigns,
    // but not which. Until the user marks the list, every stored id must keep the
    // category it had — a move here would orphan its layer flags.
    const revived = migrateAndValidate(v8FileWithStackedNapkin())
    expect(getCatalogEntry(revived.project.scene.objects.h1.catalogId).category).toBe('tableDecor')
    expect(getCatalogEntry(revived.project.scene.objects.n1.catalogId).category).toBe('tableware')
  })

  /** A v8 resort project with one chandelier hung at `elevation`. */
  function v8ResortHang(elevation: number) {
    const pack = getVenuePack('resort')!
    const entry = getCatalogEntry('lamp.chandelier-diamond')
    const file = v8File()
    const project = file.project as {
      scene: {
        venue: { venuePackId?: string; size: { width: number; depth: number }; wallHeight: number }
        objects: Record<string, unknown>
        objectOrder: string[]
      }
    }
    project.scene.venue.venuePackId = pack.id
    project.scene.venue.size = { ...pack.size }
    project.scene.venue.wallHeight = pack.wallHeight
    project.scene.objects = {
      c1: {
        ...base,
        id: 'c1',
        catalogId: entry.id,
        size: { ...entry.defaultSize },
        transform: { position: { x: 578, y: 190 }, rotation: 0, elevation },
      },
    }
    project.scene.objectOrder = ['c1']
    return JSON.parse(JSON.stringify(file))
  }

  /** The legal band for that fixture, from the live pack and the live constant. */
  function resortHangRange() {
    const pack = getVenuePack('resort')!
    return hangRange(pack, pack.wallHeight, getCatalogEntry('lamp.chandelier-diamond').defaultSize.height)
  }

  it('leaves a legally hung fixture exactly where it was', () => {
    const range = resortHangRange()
    const revived = migrateAndValidate(v8ResortHang(range.max))
    expect(revived.project.scene.objects.c1.transform.elevation).toBe(range.max)
  })

  it('pulls a fixture stored below the legal floor back into range', () => {
    const range = resortHangRange()
    const revived = migrateAndValidate(v8ResortHang(range.min - 100))
    expect(revived.project.scene.objects.c1.transform.elevation).toBe(range.min)
  })

  it('every hung item ends the migration inside the venue s legal band', () => {
    // the property the migration exists to guarantee, stated without any literal
    const range = resortHangRange()
    for (const stored of [range.min - 500, range.min, range.max, range.max + 500]) {
      const revived = migrateAndValidate(v8ResortHang(stored))
      const { elevation } = revived.project.scene.objects.c1.transform
      expect(elevation).toBeGreaterThanOrEqual(range.min)
      expect(elevation).toBeLessThanOrEqual(range.max)
    }
  })

  it('leaves a procedural-room fixture alone — it has no pack input that can move', () => {
    // hangRange's other inputs (the object's height, venue.wallHeight) are stored IN
    // the file and no migration rewrites them, and MAX_DROP_FROM_CEILING only ever
    // lowers the floor of the band. Only pack.hangHeight can move under a stored
    // file, and a procedural room has no pack — so clamping there could only rewrite
    // values the app never wrote.
    const entry = getCatalogEntry('lamp.chandelier-diamond')
    const file = v8File()
    const project = file.project as {
      scene: { objects: Record<string, unknown>; objectOrder: string[] }
    }
    project.scene.objects = {
      c1: {
        ...base,
        id: 'c1',
        catalogId: entry.id,
        size: { ...entry.defaultSize },
        transform: { position: { x: 500, y: 500 }, rotation: 0, elevation: 1070 },
      },
    }
    project.scene.objectOrder = ['c1']
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.objects.c1.transform.elevation).toBe(1070)
  })

  it('does not touch objects that are not ceiling fixtures', () => {
    const range = resortHangRange()
    const file = v8ResortHang(range.max) as {
      project: { scene: { objects: Record<string, Record<string, unknown>>; objectOrder: string[] } }
    }
    const table = getCatalogEntry('table.round')
    file.project.scene.objects.t1 = {
      ...base,
      id: 't1',
      catalogId: table.id,
      size: { ...table.defaultSize },
      // a table parked on the raised reception deck keeps its elevation
      transform: { position: { x: 5000, y: 1200 }, rotation: 0, elevation: 470 },
    }
    file.project.scene.objectOrder.push('t1')
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.objects.t1.transform.elevation).toBe(470)
  })
})

/**
 * v9 → v10: `bar.straight` retires into the three baked bar pieces, and stored
 * `dj.booth` objects are resized for the model swap.
 *
 * The id really is gone from the catalog, so these tests cannot build a
 * `bar.straight` through `createObject` — they write the stored shape directly,
 * which is what a v9 file on disk actually looks like.
 */
const FIXTURE_IDS_V10 = ['fixture-resort-001', 'fixture-resort-002', 'fixture-resort-003']

function v9File(venuePackId: string | null, objects: Record<string, unknown>, order: string[]): unknown {
  const pack = venuePackId ? getVenuePack(venuePackId)! : null
  return {
    schemaVersion: 9,
    app: 'hanan-app',
    savedAt: new Date().toISOString(),
    project: {
      id: 'p9',
      schemaVersion: 9,
      name: 'v9',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scene: {
        venue: pack
          ? { size: { ...pack.size }, wallHeight: pack.wallHeight, floor: { color: '#efebe4' }, elements: [], venuePackId }
          : { size: { width: 2400, depth: 1600 }, wallHeight: 350, floor: { color: '#efebe4' }, elements: [] },
        objects,
        objectOrder: order,
        settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true, layers: {} },
      },
    },
  }
}

const storedObject = (id: string, catalogId: string, size: Record<string, number>, x = 2100, y = 200) => ({
  id,
  catalogId,
  name: '',
  transform: { position: { x, y }, rotation: 0, elevation: 0 },
  size,
  parentId: null,
  appearance: {},
  flags: { locked: false, visible: true },
  meta: {},
})

describe('v9 → v10 bar.straight retires, dj.booth resizes', () => {
  const savedResortProject = () =>
    v9File(
      'resort',
      {
        b1: storedObject('b1', 'bar.straight', { width: 580, depth: 80, height: 237 }, 2100, 200),
        d1: storedObject('d1', 'dj.booth', { width: 208, depth: 91, height: 143 }, 2400, 1500),
      },
      ['b1', 'd1'],
    )

  it('turns one stored bar into the three baked pieces, at the fixture positions', () => {
    const revived = migrateAndValidate(savedResortProject())
    const objects = revived.project.scene.objects
    expect(objects.b1).toBeUndefined()
    for (const id of FIXTURE_IDS_V10) expect(objects[id]).toBeDefined()
    expect(FIXTURE_IDS_V10.map((id) => objects[id].catalogId)).toEqual([
      'bar.back-wall',
      'bar.resort-left',
      'bar.resort-right',
    ])
    // the positions the bake produced, not an offset off the retired object
    expect(objects['fixture-resort-001'].transform.position).toEqual({ x: 2189, y: 42.95 })
    expect(objects['fixture-resort-002'].transform.position).toEqual({ x: 2059.1, y: 275.65 })
    expect(objects['fixture-resort-003'].transform.position).toEqual({ x: 2318.9, y: 275.65 })
  })

  it('seeds them frozen, so a converted project behaves like a fresh one', () => {
    const objects = migrateAndValidate(savedResortProject()).project.scene.objects
    for (const id of FIXTURE_IDS_V10) {
      expect(objects[id].flags).toEqual({ locked: true, visible: true, frozen: true })
      expect(objects[id].meta.fixture).toBe(true)
      expect(objects[id].parentId).toBeNull()
    }
  })

  it('resizes the stored DJ booth for the model swap', () => {
    // `migrateAndValidate` drives the WHOLE chain, so this lands on the catalogue's
    // size of today, not on v10's — v10 set the GLB's full bounds and v10→v11 then
    // took them to 0.7. Reading `defaultSize` rather than writing the number is what
    // keeps that true across both steps and the next one (BRIEF §1.7).
    const objects = migrateAndValidate(savedResortProject()).project.scene.objects
    expect(objects.d1.size).toEqual(getCatalogEntry('dj.booth').defaultSize)
  })

  it('the v9 → v10 step alone already un-squashes the booth', () => {
    // Stated without a literal, and separately from the chain assertion above: once
    // v10→v11 exists, the full chain would land on the catalogue size even if this
    // step did nothing, so the step needs its own witness. What it exists to prevent
    // is the stored 208 × 91 × 143 reaching propModel, which drew the re-modelled
    // GLB squashed to 0.37 on depth.
    const stored = { width: 208, depth: 91, height: 143 }
    const stepped = migrations[9](savedResortProject()) as {
      project: { scene: { objects: Record<string, { size: Record<string, number> }> } }
    }
    expect(stepped.project.scene.objects.d1.size).not.toEqual(stored)
  })

  it('leaves objectOrder in step with objects, and no bar.straight anywhere', () => {
    const scene = migrateAndValidate(savedResortProject()).project.scene
    expect(new Set(scene.objectOrder)).toEqual(new Set(Object.keys(scene.objects)))
    expect(scene.objectOrder).toHaveLength(Object.keys(scene.objects).length)
    expect(JSON.stringify(scene)).not.toContain('bar.straight')
    // fixtures draw first, exactly as createDefaultScene seeds them
    expect(scene.objectOrder.slice(0, 3)).toEqual(FIXTURE_IDS_V10)
  })

  it('every id the migration can produce actually exists in the catalog', () => {
    // the same guard v1→v2 carries: a migration that writes a dead id is a
    // project that cannot be opened, because getCatalogEntry throws
    const objects = migrateAndValidate(savedResortProject()).project.scene.objects
    for (const o of Object.values(objects)) expect(() => getCatalogEntry(o.catalogId)).not.toThrow()
  })

  it('gives the bar to a resort project that never had one', () => {
    // createDefaultScene copies fixtures into the scene at CREATION and nothing
    // re-seeds on load, so without this a project saved before the bake would show
    // a hall with no bar while every new project has one
    const file = v9File('resort', { d1: storedObject('d1', 'dj.booth', { width: 208, depth: 91, height: 143 }) }, ['d1'])
    const objects = migrateAndValidate(file).project.scene.objects
    for (const id of FIXTURE_IDS_V10) expect(objects[id]).toBeDefined()
  })

  it('does not double-seed a project that already carries the fixtures', () => {
    const first = migrateAndValidate(savedResortProject()).project
    const again = { schemaVersion: 9, app: 'hanan-app', savedAt: new Date().toISOString(), project: { ...first, schemaVersion: 9 } }
    const objects = migrateAndValidate(JSON.parse(JSON.stringify(again))).project.scene.objects
    expect(Object.values(objects).filter((o) => o.catalogId === 'bar.resort-left')).toHaveLength(1)
  })

  it('drops a bar in a procedural room instead of planting resort fittings in it', () => {
    // zoneKind only binds where the venue declares the zone, so a manual-dimensions
    // room never clamped its bar and the baked resort positions mean nothing there
    const file = v9File('procedural' as unknown as null, {}, [])
    const raw = file as { project: { scene: { venue: Record<string, unknown>; objects: Record<string, unknown>; objectOrder: string[] } } }
    raw.project.scene.venue = { size: { width: 2400, depth: 1600 }, wallHeight: 350, floor: { color: '#efebe4' }, elements: [] }
    raw.project.scene.objects = { b1: storedObject('b1', 'bar.straight', { width: 580, depth: 80, height: 237 }, 500, 400) }
    raw.project.scene.objectOrder = ['b1']
    const scene = migrateAndValidate(JSON.parse(JSON.stringify(file))).project.scene
    expect(scene.objects.b1).toBeUndefined()
    expect(Object.keys(scene.objects)).toEqual([])
    expect(scene.objectOrder).toEqual([])
  })

  it('sweeps a child orphaned by the retirement', () => {
    const file = v9File(
      'resort',
      {
        b1: storedObject('b1', 'bar.straight', { width: 580, depth: 80, height: 237 }),
        c1: { ...storedObject('c1', 'decor.vase-ceramic', { width: 17.5, depth: 23.7, height: 35 }), parentId: 'b1' },
      },
      ['b1'],
    )
    const objects = migrateAndValidate(file).project.scene.objects
    expect(objects.b1).toBeUndefined()
    expect(objects.c1).toBeUndefined()
  })
})

/**
 * v10 → v11: the DJ booth is catalogued at 0.7 of the model's own size, so every
 * stored `dj.booth` is rewritten to the smaller size.
 *
 * A v10 file holds the booth at the GLB's full bounds — that is what v9→v10 wrote
 * and what a project saved between the two migrations carries.
 */
function v10File(objects: Record<string, unknown>, order: string[]): unknown {
  const pack = getVenuePack('resort')!
  return {
    schemaVersion: 10,
    app: 'hanan-app',
    savedAt: new Date().toISOString(),
    project: {
      id: 'p10',
      schemaVersion: 10,
      name: 'v10',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scene: {
        venue: {
          size: { ...pack.size },
          wallHeight: pack.wallHeight,
          floor: { color: '#efebe4' },
          elements: [],
          venuePackId: 'resort',
        },
        objects,
        objectOrder: order,
        settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true, layers: {} },
      },
    },
  }
}

describe('v10 → v11 dj.booth shrinks to 0.7', () => {
  /** the size v9→v10 wrote: the GLB's own bounds, read off the entry that states them */
  const modelSize = () => getCatalogEntry('dj.booth').modelSize!

  const savedV10Project = () =>
    v10File(
      {
        d1: storedObject('d1', 'dj.booth', { ...modelSize() }, 2400, 1500),
        t1: storedObject('t1', 'table.round', { ...getCatalogEntry('table.round').defaultSize }, 800, 800),
      },
      ['d1', 't1'],
    )

  it('rewrites a stored booth to the catalogued size', () => {
    const objects = migrateAndValidate(savedV10Project()).project.scene.objects
    expect(objects.d1.size).toEqual(getCatalogEntry('dj.booth').defaultSize)
  })

  it('and that size really is smaller than the model the loader fits', () => {
    // The silent trap this pair guards: `defaultSize` shrank, so the entry MUST also
    // state `modelSize` — the loader fits by `size / (modelSize ?? defaultSize)`, and
    // without it the ratio falls back to 1 and the stand stays full size in 3D while
    // 2D draws it at 0.7. `modelSize!` above throws if it is ever dropped; this says
    // the catalogued size is a genuine reduction of it.
    const { width, depth, height } = getCatalogEntry('dj.booth').defaultSize
    expect(width).toBeLessThan(modelSize().width)
    expect(depth).toBeLessThan(modelSize().depth)
    expect(height).toBeLessThan(modelSize().height)
  })

  it('advances both version fields to the current one', () => {
    const revived = migrateAndValidate(savedV10Project())
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves objects of every other catalog id alone', () => {
    const before = getCatalogEntry('table.round').defaultSize
    const scene = migrateAndValidate(savedV10Project()).project.scene
    expect(scene.objects.t1.size).toEqual(before)
    expect(scene.objects.t1.transform.position).toEqual({ x: 800, y: 800 })
    expect(new Set(scene.objectOrder)).toEqual(new Set(Object.keys(scene.objects)))
  })

  it('does not move the booth — it only shrinks it', () => {
    // no re-clamp is owed: the booth only ever lives in ZONE_DJ, it only shrinks,
    // and a smaller box inside a rectangle it already fitted still fits it
    const objects = migrateAndValidate(savedV10Project()).project.scene.objects
    expect(objects.d1.transform.position).toEqual({ x: 2400, y: 1500 })
    expect(objects.d1.transform.rotation).toBe(0)
  })

  it('is idempotent — a booth already at the new size is unchanged', () => {
    const file = v10File({ d1: storedObject('d1', 'dj.booth', { ...getCatalogEntry('dj.booth').defaultSize }) }, ['d1'])
    const objects = migrateAndValidate(file).project.scene.objects
    expect(objects.d1.size).toEqual(getCatalogEntry('dj.booth').defaultSize)
  })
})

/**
 * v11 → v12: the rolled napkin is catalogued at 0.62 of the model's own size, so
 * every stored `decor.napkin-folded` is rewritten to the smaller size.
 *
 * A v11 file holds the napkin at the GLB's full bounds — that is what the entry
 * declared from the day it was catalogued until this round, so it is what every
 * project saved before the fix carries.
 *
 * The napkin is a CHILD of a place setting, which is itself a child of a table,
 * so these files are built with the parent chain intact: the migration walks the
 * objects map rather than objectOrder precisely because a napkin never appears in
 * objectOrder, and a test on a top-level napkin would not prove that.
 */
function v11File(objects: Record<string, unknown>, order: string[]): unknown {
  const pack = getVenuePack('resort')!
  return {
    schemaVersion: 11,
    app: 'hanan-app',
    savedAt: new Date().toISOString(),
    project: {
      id: 'p11',
      schemaVersion: 11,
      name: 'v11',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scene: {
        venue: {
          size: { ...pack.size },
          wallHeight: pack.wallHeight,
          floor: { color: '#efebe4' },
          elements: [],
          venuePackId: 'resort',
        },
        objects,
        objectOrder: order,
        settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true, layers: {} },
      },
    },
  }
}

describe('v11 → v12 the rolled napkin shrinks onto the plate', () => {
  const NAPKIN = 'decor.napkin-folded'
  const SETTING = 'decor.place-setting'
  /** the size a v11 file holds: the GLB's own bounds, read off the entry that states them */
  const modelSize = () => getCatalogEntry(NAPKIN).modelSize!

  const savedV11Project = () => {
    const table = {
      ...storedObject('t1', 'table.round', { ...getCatalogEntry('table.round').defaultSize }, 800, 800),
    }
    const cover = {
      ...storedObject('c1', SETTING, { ...getCatalogEntry(SETTING).defaultSize }, 0, -60),
      parentId: 't1',
      attachment: { kind: 'surface' },
    }
    const napkin = {
      ...storedObject('n1', NAPKIN, { ...modelSize() }, 0, -60),
      parentId: 't1',
      attachment: { kind: 'surface', stackedOn: 'c1' },
    }
    // the other two napkins did NOT change size, and one of them is here to say so
    const other = {
      ...storedObject('n2', 'decor.napkin-white', { ...getCatalogEntry('decor.napkin-white').defaultSize }, 0, 60),
      parentId: 't1',
      attachment: { kind: 'surface', stackedOn: 'c1' },
    }
    return v11File({ t1: table, c1: cover, n1: napkin, n2: other }, ['t1'])
  }

  it('rewrites a stored napkin to the catalogued size', () => {
    const objects = migrateAndValidate(savedV11Project()).project.scene.objects
    expect(objects.n1.size).toEqual(getCatalogEntry(NAPKIN).defaultSize)
  })

  it('and that size really is smaller than the model the loader fits', () => {
    // The silent trap this pair guards: `defaultSize` shrank, so the entry MUST
    // also state `modelSize` — the loader fits by `size / (modelSize ??
    // defaultSize)`, and without it the ratio falls back to 1, so 3D keeps
    // drawing the 30.8 cm napkin while 2D draws the small one and nothing fails.
    // `modelSize!` above throws if the field is ever dropped; this says the
    // catalogued size is a genuine reduction of it.
    const { width, depth, height } = getCatalogEntry(NAPKIN).defaultSize
    expect(width).toBeLessThan(modelSize().width)
    expect(depth).toBeLessThan(modelSize().depth)
    expect(height).toBeLessThan(modelSize().height)
  })

  it('shrinks it UNIFORMLY, so the loader cannot squash the model', () => {
    // a per-axis fit onto a non-uniform reduction would stretch the napkin out of
    // shape in 3D while 2D drew a plausible rectangle — the same reason
    // `decor.place-setting` is a uniform 0.8 of its own file
    const size = getCatalogEntry(NAPKIN).defaultSize
    const model = modelSize()
    const s = size.width / model.width
    expect(size.depth / model.depth).toBeCloseTo(s, 3)
    expect(size.height / model.height).toBeCloseTo(s, 3)
  })

  it('advances both version fields to the current one', () => {
    const revived = migrateAndValidate(savedV11Project())
    expect(revived.schemaVersion).toBe(SCHEMA_VERSION)
    expect(revived.project.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('leaves the cover, the table and the other napkin alone', () => {
    const scene = migrateAndValidate(savedV11Project()).project.scene
    expect(scene.objects.t1.size).toEqual(getCatalogEntry('table.round').defaultSize)
    expect(scene.objects.c1.size).toEqual(getCatalogEntry(SETTING).defaultSize)
    expect(scene.objects.n2.size).toEqual(getCatalogEntry('decor.napkin-white').defaultSize)
  })

  it('keeps the napkin pinned to its cover — the link is what the size fix rides on', () => {
    const objects = migrateAndValidate(savedV11Project()).project.scene.objects
    expect(objects.n1.attachment).toEqual({ kind: 'surface', stackedOn: 'c1' })
    expect(objects.n1.parentId).toBe('t1')
  })

  it('does not move the napkin — where it sits is derived, not stored', () => {
    // `stackedPosition` re-pins it onto the plate on the first clamp after load,
    // so a position written here would be a second copy of that rule
    const objects = migrateAndValidate(savedV11Project()).project.scene.objects
    expect(objects.n1.transform.position).toEqual({ x: 0, y: -60 })
    expect(objects.n1.transform.rotation).toBe(0)
  })

  it('is idempotent — a napkin already at the new size is unchanged', () => {
    const file = v11File(
      { n1: storedObject('n1', NAPKIN, { ...getCatalogEntry(NAPKIN).defaultSize }) },
      ['n1'],
    )
    const objects = migrateAndValidate(file).project.scene.objects
    expect(objects.n1.size).toEqual(getCatalogEntry(NAPKIN).defaultSize)
  })
})

describe('migrateAndValidate', () => {
  it('accepts a current-version ProjectFile round-trip', () => {
    const file = validFile()
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived).toEqual(file)
    expect(revived.project.scene.venue.size.width).toBe(2400)
  })

  it('round-trips stored lighting settings (v5)', () => {
    const file = validFile()
    file.project.scene.settings.lighting = { mode: 'night', sunAzimuth: 120, sunElevation: 30, sunIntensity: 0.1 }
    const revived = migrateAndValidate(JSON.parse(JSON.stringify(file)))
    expect(revived.project.scene.settings.lighting).toEqual({
      mode: 'night',
      sunAzimuth: 120,
      sunElevation: 30,
      sunIntensity: 0.1,
    })
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
