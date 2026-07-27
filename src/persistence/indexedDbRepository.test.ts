import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject, createProject } from '../core/model/factory'
import { createSavedLayout, venueSignature } from '../core/savedLayouts'
import { makeProjectFile } from './autosave'
import { IndexedDbRepository } from './indexedDbRepository'

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
})
