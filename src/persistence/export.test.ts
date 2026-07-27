/**
 * Saved layouts live in IndexedDB — i.e. in one browser. Exporting a project
 * without them means opening the file elsewhere loses every personal layout the
 * project refers to (PLAN-05 gap 6).
 */
import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject } from '../core/model/factory'
import { createSavedLayout, LAYOUT_SCHEMA_VERSION } from '../core/savedLayouts'
import { readExportedLayouts } from './export'

function savedLayout() {
  const scene = createDefaultScene(2400, 1600, 'resort')
  const table = createObject('table.round', { x: 400, y: 500 })
  scene.objects[table.id] = table
  scene.objectOrder.push(table.id)
  return createSavedLayout('אישית', scene, [table.id], 'layout')!
}

describe('layouts carried by an exported project file', () => {
  it('round-trips through JSON', () => {
    const layout = savedLayout()
    const file = { app: 'hanan-app', layouts: [layout] }
    expect(readExportedLayouts(JSON.parse(JSON.stringify(file)))).toEqual([layout])
  })

  it('upgrades an old record and drops an unreadable one', () => {
    const layout = savedLayout()
    const v1 = { ...layout } as Record<string, unknown>
    delete v1.kind
    delete v1.schemaVersion

    const read = readExportedLayouts({ layouts: [v1, { id: 'junk' }, null] })
    expect(read).toHaveLength(1)
    expect(read[0].kind).toBe('tables')
    expect(read[0].schemaVersion).toBe(LAYOUT_SCHEMA_VERSION)
  })

  it('a file from a build that did not export layouts imports fine', () => {
    expect(readExportedLayouts({ app: 'hanan-app' })).toEqual([])
    expect(readExportedLayouts({ layouts: 'not an array' })).toEqual([])
    expect(readExportedLayouts(null)).toEqual([])
  })
})
