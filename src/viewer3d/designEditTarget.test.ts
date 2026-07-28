/**
 * Which table a double-click opens for decor editing, in 3D (source doc §52).
 *
 * The gesture was closed with the user as "double-click in BOTH views", and the
 * 3D half is a SECOND copy of the decision — viewer3d must not import from
 * editor2d, and A1's version takes a KonvaEventObject. Two copies of a rule is
 * exactly the thing that drifts, so the four branches are pinned here.
 *
 * The 2D twin is `onObjectDblClick` / `onChildDblClick` in
 * editor2d/dragController.ts. If either side gains a branch, this file should
 * fail until both agree.
 *
 * ⚠ This imports a .tsx component module into a NODE-environment test, which
 * BRIEF §1.7 warns is usually impossible. It works because `designEditTargetOf`
 * is a pure function over the scene and the import graph is only ever
 * evaluated, never rendered — no DOM, no WebGL, no R3F hooks run. Measured, not
 * assumed: probed before this file was written.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { attachedChairs } from '../core/model/seatingReconciler'
import { addObject, addObjectToSurface, newProject } from '../state/actions'
import { isTable } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { designEditTargetOf } from './ObjectGroup'

const scene = () => useEditorStore.getState().scene

const TABLE = 'table.round'
const DECOR = 'decor.vase-ceramic'
/** a top-level object that is NOT a table — no `seating`, so no decor to edit */
const PLANT = 'plant.potted'

beforeEach(() => {
  newProject({ name: 'dblclick', venueWidth: 2400, venueDepth: 1600 })
})

describe('designEditTargetOf — the 3D double-click', () => {
  it('opens on a table that was double-clicked directly', () => {
    const table = addObject(TABLE, { x: 800, y: 600 })
    expect(isTable(scene().objects[table])).toBe(true)
    expect(designEditTargetOf(scene(), table)).toBe(table)
  })

  it('opens on the PARENT when the decor on it was double-clicked', () => {
    const table = addObject(TABLE, { x: 800, y: 600 })
    const decor = addObjectToSurface(DECOR, table, { x: 800, y: 600 })!
    // the centrepiece is the biggest target on the table and the likeliest aim
    expect(scene().objects[decor].attachment?.kind).toBe('surface')
    expect(designEditTargetOf(scene(), decor)).toBe(table)
  })

  it('does NOT open on a chair — a seat still means "drill in"', () => {
    const table = addObject(TABLE, { x: 800, y: 600 })
    const chairs = attachedChairs(scene(), table)
    expect(chairs.length).toBeGreaterThan(0)
    for (const chair of chairs) {
      expect(chair.attachment?.kind).toBe('seat')
      expect(designEditTargetOf(scene(), chair.id)).toBeNull()
    }
  })

  it('does nothing for a top-level object that is not a table', () => {
    const plant = addObject(PLANT, { x: 400, y: 400 })
    expect(isTable(scene().objects[plant])).toBe(false)
    expect(designEditTargetOf(scene(), plant)).toBeNull()
  })

  it('does nothing for an id that is not in the scene', () => {
    expect(designEditTargetOf(scene(), 'no-such-object')).toBeNull()
  })

  /**
   * The chair branch is the one that only exists because of how 3D renders:
   * chairs are instanced INSIDE the table's group, so a hit on a chair resolves
   * to the table unless the chair handler stops it. If this ever returns the
   * table, double-clicking a chair silently opens the mode.
   */
  it('separates a chair from the decor beside it on the same table', () => {
    const table = addObject(TABLE, { x: 800, y: 600 })
    const decor = addObjectToSurface(DECOR, table, { x: 800, y: 600 })!
    const chair = attachedChairs(scene(), table)[0]
    expect(designEditTargetOf(scene(), decor)).toBe(table)
    expect(designEditTargetOf(scene(), chair.id)).toBeNull()
  })
})
