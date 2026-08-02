import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject } from './model/factory'
import type { SceneObject, SceneState } from './model/types'
import {
  createHallTablesLayout,
  createLightingLayout,
  createSavedLayout,
  createTableDesignLayout,
  instantiateSavedLayout,
  LAYOUT_SCHEMA_VERSION,
  migrateSavedLayout,
  missingCatalogIds,
  sameVenueSignature,
  snapshotSelection,
  venueSignature,
} from './savedLayouts'

function fixture(): { scene: SceneState; table: SceneObject; chair: SceneObject; decor: SceneObject } {
  const scene = createDefaultScene(2400, 1600)
  const table = createObject('table.round', { x: 410, y: 520 })
  table.appearance = { top: { color: '#112233' } }
  table.seating!.count = 1
  table.meta.number = 7
  table.flags.locked = true
  const chair = createObject('chair.x-white', { x: 0, y: -120 })
  chair.parentId = table.id
  chair.attachment = { kind: 'seat', seatIndex: 0, manual: false }
  chair.appearance = { frame: { color: '#445566' } }
  const decor = createObject('decor.candlestick-brass', { x: 10, y: 15 })
  decor.parentId = table.id
  decor.attachment = { kind: 'surface' }
  decor.appearance = { body: { color: '#778899' } }
  scene.objects = { [table.id]: table, [chair.id]: chair, [decor.id]: decor }
  scene.objectOrder = [table.id]
  return { scene, table, chair, decor }
}

describe('saved layouts', () => {
  it('signs pack venues by id and manual venues by exact dimensions', () => {
    expect(venueSignature({ size: { width: 1, depth: 2 }, venuePackId: 'resort' })).toEqual({
      kind: 'pack',
      venuePackId: 'resort',
    })
    const manual = venueSignature({ size: { width: 2400, depth: 1600 } })
    expect(manual).toEqual({ kind: 'manual', width: 2400, depth: 1600 })
    expect(sameVenueSignature(manual, { kind: 'manual', width: 2400, depth: 1600 })).toBe(true)
    expect(sameVenueSignature(manual, { kind: 'manual', width: 2401, depth: 1600 })).toBe(false)
  })

  it('promotes selected children, strips appearance, and omits surface decor in layout mode', () => {
    const { scene, table, chair, decor } = fixture()
    const [snapshot] = snapshotSelection(scene, [decor.id, chair.id, table.id], 'layout')
    expect(snapshot.root.id).toBe(table.id)
    expect(snapshot.root.transform).toEqual(table.transform)
    expect(snapshot.root.size).toEqual(table.size)
    expect(snapshot.root.seating).toEqual(table.seating)
    expect(snapshot.root.appearance).toEqual({})
    expect(snapshot.children.map((child) => child.id)).toEqual([chair.id])
    expect(snapshot.children[0].appearance).toEqual({})
  })

  it('preserves appearance and attached decor in layout-design mode', () => {
    const { scene, table, chair, decor } = fixture()
    const [snapshot] = snapshotSelection(scene, [decor.id], 'layout-design')
    expect(snapshot.root.appearance).toEqual(table.appearance)
    expect(snapshot.children.map((child) => child.id)).toEqual([chair.id, decor.id])
    expect(snapshot.children[1].appearance).toEqual(decor.appearance)
  })

  it('creates only named, non-empty layouts and never stores scene lighting', () => {
    const { scene, table } = fixture()
    scene.settings.lighting = {
      mode: 'night',
      sunAzimuth: 1,
      sunElevation: 2,
      sunIntensity: 3,
    }
    expect(createSavedLayout('  ', scene, [table.id], 'layout')).toBeNull()
    expect(createSavedLayout('one', scene, [], 'layout')).toBeNull()
    const saved = createSavedLayout('  Dinner  ', scene, [table.id], 'layout', '2026-07-21T00:00:00Z')!
    expect(saved.name).toBe('Dinner')
    expect(saved).not.toHaveProperty('lighting')
  })

  it('instantiates fresh identities, parent links, table numbers and editable flags', () => {
    const { scene, table, chair } = fixture()
    const saved = createSavedLayout('Dinner', scene, [table.id], 'layout-design')!
    const originalIds = new Set([table.id, chair.id])
    const destination = createDefaultScene(2400, 1600)
    const existing = createObject('table.round', { x: 100, y: 100 })
    existing.meta.number = 4
    destination.objects[existing.id] = existing
    destination.objectOrder.push(existing.id)

    const [rootId] = instantiateSavedLayout(destination, saved)
    const root = destination.objects[rootId]
    const children = Object.values(destination.objects).filter((object) => object.parentId === rootId)
    expect(originalIds.has(rootId)).toBe(false)
    expect(root.transform.position).toEqual(table.transform.position)
    expect(root.meta).toMatchObject({ number: 5, layoutTables: saved.id })
    expect(root.flags).toEqual({ locked: false, visible: true })
    expect(children).toHaveLength(2)
    expect(children.every((child) => !originalIds.has(child.id) && child.parentId === rootId)).toBe(true)
    expect(children.every((child) => child.flags.locked === false && child.flags.visible)).toBe(true)
  })
})

describe('layout kinds (schema v8)', () => {
  it('tags each kind with its own meta key so two layouts coexist', () => {
    const { scene, table } = fixture()
    const tables = createSavedLayout('שולחנות', scene, [table.id], 'layout')!
    expect(tables.kind).toBe('tables')

    const lamp = createObject('lamp.pendant', { x: 800, y: 800 })
    scene.objects[lamp.id] = lamp
    scene.objectOrder.push(lamp.id)
    const lighting = createLightingLayout('תאורה', scene)!
    expect(lighting.kind).toBe('lighting')
    expect(lighting.subtrees.map((s) => s.root.catalogId)).toEqual(['lamp.pendant'])

    const destination = createDefaultScene(2400, 1600)
    const [tableId] = instantiateSavedLayout(destination, tables)
    const [lampId] = instantiateSavedLayout(destination, lighting)
    expect(destination.objects[tableId].meta.layoutTables).toBe(tables.id)
    expect(destination.objects[tableId].meta.layoutLighting).toBeUndefined()
    expect(destination.objects[lampId].meta.layoutLighting).toBe(lighting.id)
    expect(destination.objects[lampId].meta.layoutTables).toBeUndefined()
  })

  it('a hall layout takes every table in the hall but no baked fixture', () => {
    const { scene, table } = fixture()
    const second = createObject('table.round', { x: 900, y: 900 })
    const baked = createObject('table.round', { x: 1200, y: 1200 })
    baked.flags.frozen = true
    const lamp = createObject('lamp.pendant', { x: 800, y: 800 })
    for (const object of [second, baked, lamp]) {
      scene.objects[object.id] = object
      scene.objectOrder.push(object.id)
    }

    const hall = createHallTablesLayout('כל האולם', scene, 'layout')!
    expect(hall.kind).toBe('tables')
    expect(hall.subtrees.map((s) => s.root.id)).toEqual([table.id, second.id])

    expect(createHallTablesLayout('ריק', createDefaultScene(2400, 1600), 'layout')).toBeNull()
  })

  it('a lighting layout needs lighting in the scene', () => {
    const { scene } = fixture()
    expect(createLightingLayout('ריק', scene)).toBeNull()
  })

  it('captures only a table’s surface decor as a table design', () => {
    const { scene, table, chair, decor } = fixture()
    const design = createTableDesignLayout('זהב', scene, table.id)!
    expect(design.kind).toBe('tableDesign')
    expect(design.subtrees).toHaveLength(1)
    expect(design.subtrees[0].root.id).toBe(table.id)
    expect(design.subtrees[0].children.map((c) => c.id)).toEqual([decor.id])
    expect(design.subtrees[0].children.map((c) => c.id)).not.toContain(chair.id)
    // a bare table has no design to save
    const bare = createDefaultScene(2400, 1600)
    const empty = createObject('table.round', { x: 100, y: 100 })
    bare.objects[empty.id] = empty
    bare.objectOrder.push(empty.id)
    expect(createTableDesignLayout('ריק', bare, empty.id)).toBeNull()
  })
})

describe('stored layout records', () => {
  it('upgrades a v1 record (no kind, no version) to a table layout', () => {
    const { scene, table } = fixture()
    const saved = createSavedLayout('ותיקה', scene, [table.id], 'layout')!
    const v1 = { ...saved } as Record<string, unknown>
    delete v1.kind
    delete v1.schemaVersion

    const migrated = migrateSavedLayout(v1)!
    expect(migrated.kind).toBe('tables')
    expect(migrated.schemaVersion).toBe(LAYOUT_SCHEMA_VERSION)
    expect(migrated.name).toBe('ותיקה')
    expect(migrated.subtrees).toEqual(saved.subtrees)
  })

  it('drops a record it cannot read instead of handing it to the editor', () => {
    expect(migrateSavedLayout(null)).toBeNull()
    expect(migrateSavedLayout({ id: 'x' })).toBeNull()
    expect(migrateSavedLayout('nonsense')).toBeNull()
  })

  it('reports catalog ids the catalog no longer has', () => {
    const { scene, table } = fixture()
    const saved = createSavedLayout('חסרה', scene, [table.id], 'layout')!
    expect(missingCatalogIds(saved)).toEqual([])
    saved.subtrees[0].root.catalogId = 'table.retired'
    saved.subtrees[0].root.seating!.chairCatalogId = 'chair.retired'
    expect(missingCatalogIds(saved).sort()).toEqual(['chair.retired', 'table.retired'])
  })
})
