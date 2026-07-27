import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject, createProject } from '../core/model/factory'
import {
  createSavedLayout,
  createTableDesignLayout,
  LAYOUT_SCHEMA_VERSION,
  venueSignature,
} from '../core/savedLayouts'
import { makeProjectFile } from './autosave'
import { IndexedDbRepository, layoutsRevision, subscribeLayouts } from './indexedDbRepository'

/** A resort scene with one dressed table — the source of every saved layout below. */
function authoredScene() {
  const scene = createDefaultScene(2400, 1600, 'resort')
  const table = createObject('table.round', { x: 400, y: 500 })
  const decor = createObject('decor.candelabrum-gold', { x: 0, y: 0 })
  decor.parentId = table.id
  decor.attachment = { kind: 'surface' }
  scene.objects = { [table.id]: table, [decor.id]: decor }
  scene.objectOrder = [table.id]
  return { scene, table }
}

describe('IndexedDbRepository saved layouts', () => {
  it('upgrades a v1 project database and shares layouts only across matching venues', async () => {
    const dbName = `hanan-test-${crypto.randomUUID()}`
    const project = createProject({ name: 'existing project', venuePackId: 'resort' })
    const v1 = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('projects')
        db.createObjectStore('previews')
      },
    })
    await v1.put('projects', makeProjectFile(project), project.id)
    v1.close()

    const authored = createDefaultScene(2400, 1600, 'resort')
    const table = createObject('table.round', { x: 400, y: 500 })
    authored.objects[table.id] = table
    authored.objectOrder.push(table.id)
    const saved = createSavedLayout('Shared', authored, [table.id], 'layout')!

    const firstProject = new IndexedDbRepository(dbName)
    expect((await firstProject.load(project.id))?.project.name).toBe('existing project')
    await firstProject.saveLayout(saved)

    // A second repository instance models another project/tab using the same browser DB.
    const secondProject = new IndexedDbRepository(dbName)
    expect(await secondProject.listLayouts(venueSignature(authored.venue))).toEqual([saved])
    expect(await secondProject.listLayouts({ kind: 'pack', venuePackId: 'other' })).toEqual([])
    expect(await secondProject.listLayouts({ kind: 'manual', width: 2400, depth: 1600 })).toEqual([])

    await secondProject.removeLayout(saved.id)
    expect(await firstProject.listLayouts(venueSignature(authored.venue))).toEqual([])
  })

  it('upgrades a stored record written before `kind` existed', async () => {
    const dbName = `hanan-test-${crypto.randomUUID()}`
    const { scene, table } = authoredScene()
    const saved = createSavedLayout('ותיקה', scene, [table.id], 'layout')!
    const v1Record = { ...saved } as Record<string, unknown>
    delete v1Record.kind
    delete v1Record.schemaVersion

    const db = await openDB(dbName, 2, {
      upgrade(database) {
        database.createObjectStore('projects')
        database.createObjectStore('previews')
        database.createObjectStore('layouts')
      },
    })
    await db.put('layouts', v1Record, saved.id)
    await db.put('layouts', { id: 'garbage' }, 'garbage')
    db.close()

    const repo = new IndexedDbRepository(dbName)
    const layouts = await repo.listLayouts(venueSignature(scene.venue))
    expect(layouts.map((l) => l.id)).toEqual([saved.id])
    expect(layouts[0].kind).toBe('tables')
    expect(layouts[0].schemaVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('renames, overwrites by id, and keeps table designs out of the venue list', async () => {
    const dbName = `hanan-test-${crypto.randomUUID()}`
    const repo = new IndexedDbRepository(dbName)
    const { scene, table } = authoredScene()
    const saved = createSavedLayout('לפני', scene, [table.id], 'layout')!
    const design = createTableDesignLayout('זהב', scene, table.id)!

    await repo.saveLayout(saved)
    await repo.saveLayout(design)
    await repo.renameLayout(saved.id, '  אחרי  ')
    await repo.saveLayout({ ...saved, name: 'דריסה', createdAt: saved.createdAt })

    const layouts = await repo.listLayouts(venueSignature(scene.venue))
    expect(layouts).toHaveLength(1) // the overwrite replaced, it did not append
    expect(layouts[0].name).toBe('דריסה')
    expect(await repo.listTableDesigns()).toHaveLength(1)
    expect((await repo.listTableDesigns())[0].kind).toBe('tableDesign')

    // an empty rename is a no-op rather than a nameless layout
    await repo.renameLayout(saved.id, '   ')
    expect((await repo.listLayouts(venueSignature(scene.venue)))[0].name).toBe('דריסה')
  })

  it('tells the pickers that the store changed', async () => {
    const dbName = `hanan-test-${crypto.randomUUID()}`
    const repo = new IndexedDbRepository(dbName)
    const { scene, table } = authoredScene()
    const saved = createSavedLayout('חדשה', scene, [table.id], 'layout')!
    let calls = 0
    const unsubscribe = subscribeLayouts(() => calls++)
    const before = layoutsRevision()

    await repo.saveLayout(saved)
    await repo.renameLayout(saved.id, 'שם אחר')
    await repo.removeLayout(saved.id)
    unsubscribe()
    await repo.saveLayout(saved)

    expect(calls).toBe(3) // not 4 — the listener was removed before the last write
    expect(layoutsRevision()).toBeGreaterThan(before)
  })
})
