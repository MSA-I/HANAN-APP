import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject } from './model/factory'
import type { SceneObject, SceneState } from './model/types'
import {
  createSavedLayout,
  instantiateSavedLayout,
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
    expect(root.meta).toMatchObject({ number: 5, layout: saved.id })
    expect(root.flags).toEqual({ locked: false, visible: true })
    expect(children).toHaveLength(2)
    expect(children.every((child) => !originalIds.has(child.id) && child.parentId === rootId)).toBe(true)
    expect(children.every((child) => child.flags.locked === false && child.flags.visible)).toBe(true)
  })
})
