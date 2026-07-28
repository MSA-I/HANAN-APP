/**
 * `flags.frozen` — the bake button's other half (source doc §16: "לא יהיה
 * אפשרות להסיר או להזיז את האלמנטים הללו").
 *
 * `locked` alone is not enough: the Inspector shows an "unlock" button for it,
 * so a locked fixture is one click from being movable again. Every route that
 * could move, delete, unlock or clone an object is checked here — this file IS
 * the checklist.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createObject, venueFixtures } from '../core/model/factory'
import type { Id } from '../core/model/types'
import {
  addObject,
  clearAllObjects,
  duplicateObjects,
  moveObjectsBy,
  newProject,
  pasteSubtrees,
  removeObjects,
  rotateObjectsBy,
  setLocked,
  setPosition,
  setSize,
} from './actions'
import { isEffectivelyLocked, isFrozen } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

/** A baked fixture, as `createDefaultScene` would have seeded it. */
function freeze(id: Id): void {
  useEditorStore.setState((state) => {
    state.scene.objects[id].flags = { locked: true, visible: true, frozen: true }
    state.scene.objects[id].meta.fixture = true
  })
}

let fixture: Id
let ordinary: Id

beforeEach(() => {
  newProject({ name: 'frozen-test', venuePackId: 'resort' })
  fixture = addObject('bar.straight', { x: 600, y: 600 })
  freeze(fixture)
  ordinary = addObject('table.round', { x: 1200, y: 900 })
})

describe('frozen venue fixtures', () => {
  it('1. editable() filters it out of every move, rotate and resize path', () => {
    const before = { ...scene().objects[fixture].transform.position }
    const size = { ...scene().objects[fixture].size }

    moveObjectsBy([fixture], { x: 200, y: 200 })
    rotateObjectsBy([fixture], 45)
    setPosition(fixture, { x: 50, y: 50 })
    setSize(fixture, { width: size.width + 100 })

    expect(scene().objects[fixture].transform.position).toEqual(before)
    expect(scene().objects[fixture].transform.rotation).toBe(0)
    expect(scene().objects[fixture].size).toEqual(size)
  })

  it('2. removeObjects skips it while deleting its neighbours', () => {
    removeObjects([fixture, ordinary])
    expect(scene().objects[fixture]).toBeDefined()
    expect(scene().objects[ordinary]).toBeUndefined()
  })

  it('3. clearAllObjects keeps it — "clear the event", not "clear the venue"', () => {
    clearAllObjects()
    // The resort now SHIPS fixtures (the baked bar), so what survives is this
    // test's own frozen object plus those. Asserting "everything left is frozen,
    // and the ordinary table is not among it" is the actual rule, and it does not
    // go stale the next time the venue bakes one more fitting.
    const left = Object.keys(scene().objects)
    expect(left).toContain(fixture)
    expect(left).not.toContain(ordinary)
    expect(left.every((id) => isFrozen(scene().objects[id]))).toBe(true)
    expect(scene().objectOrder).toEqual(left)
  })

  it('4. setLocked cannot open its lock', () => {
    setLocked([fixture], false)
    expect(scene().objects[fixture].flags.locked).toBe(true)
    expect(isEffectivelyLocked(scene(), scene().objects[fixture])).toBe(true)
    // an ordinary object still unlocks normally
    setLocked([ordinary], true)
    setLocked([ordinary], false)
    expect(scene().objects[ordinary].flags.locked).toBe(false)
  })

  it('5. the Inspector reads `isFrozen`, which no UI can clear', () => {
    // the panel branches on this selector (InspectorPanel → FrozenInspector);
    // there is no action that writes flags.frozen = false
    expect(isFrozen(scene().objects[fixture])).toBe(true)
    expect(isFrozen(scene().objects[ordinary])).toBe(false)
  })

  it('6. a duplicate or a paste of it is ordinary furniture', () => {
    const [copy] = duplicateObjects([fixture])
    expect(copy).toBeDefined()
    expect(scene().objects[copy].flags.frozen).toBeUndefined()
    expect(scene().objects[copy].flags.locked).toBe(false)

    const [pasted] = pasteSubtrees([{ root: scene().objects[fixture], children: [] }])
    expect(scene().objects[pasted].flags.frozen).toBeUndefined()
    expect(scene().objects[pasted].flags.locked).toBe(false)
  })
})

describe('seeding fixtures into a new project', () => {
  it('seeds the resort bar, and nothing for a venue that has no bake', () => {
    // The bar was baked on 2026-07-28: two counter halves and the back wall.
    // Every seeded object arrives frozen, which is what makes it a fitting rather
    // than furniture the user happens to have been given.
    const resort = venueFixtures('resort')
    expect(resort.map((o) => o.catalogId).sort()).toEqual([
      'bar.back-wall',
      'bar.resort-left',
      'bar.resort-right',
    ])
    for (const o of resort) expect(o.flags).toEqual({ locked: true, visible: true, frozen: true })
    expect(venueFixtures(null)).toEqual([])
    expect(venueFixtures('no-such-venue')).toEqual([])
  })

  it('re-freezes every seeded object and drops one whose catalog id is gone', () => {
    const baked = createObject('bar.straight', { x: 100, y: 100 })
    baked.id = 'fixture-resort-001'
    baked.flags = { locked: false, visible: true }
    const retired = createObject('bar.straight', { x: 200, y: 200 })
    retired.catalogId = 'bar.no-longer-real'

    const seeded = venueFixtures('resort', { resort: [baked, retired] })

    expect(seeded.map((o) => o.id)).toEqual(['fixture-resort-001'])
    expect(seeded[0].flags).toEqual({ locked: true, visible: true, frozen: true })
    // a clone, not the table's own object — editing a scene must not edit the bake
    expect(seeded[0]).not.toBe(baked)
  })
})
