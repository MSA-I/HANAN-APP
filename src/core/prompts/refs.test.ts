/**
 * PLAN-05 C3 — the visibility oracle's seam, tested from the core side.
 *
 * `compose.test.ts` is already long and is about the prompt; this file is about
 * one question: what happens to `selectRefs` when somebody hands it a
 * measurement, and — much more importantly — what happens when nobody does.
 */
import { describe, expect, it } from 'vitest'
import { createDefaultScene, createObject } from '../model/factory'
import type { SceneObject, SceneState, Vec2 } from '../model/types'
import { getVenuePack, type SealedCamera } from '../venuePacks'
import { composeExport } from './compose'
import { MIN_COVERAGE_FRACTION } from './coverage'
import { groupForRefs, objectsInFrame, selectRefs, type Coverage } from './refs'

const PACK = 'resort'
const cameras = getVenuePack(PACK)!.cameras!
const cam = (id: string): SealedCamera => cameras.find((c) => c.id === id)!

function sceneWith(...objects: SceneObject[]): SceneState {
  const scene = createDefaultScene(undefined, undefined, PACK)
  scene.objects = {}
  scene.objectOrder = []
  for (const obj of objects) {
    scene.objects[obj.id] = obj
    if (!obj.parentId) scene.objectOrder.push(obj.id)
  }
  return scene
}

const at = (x: number, y: number): Vec2 => ({ x, y })
const venue = { wallHeight: 1160, venuePackId: PACK }
const MIDDLE = at(2100, 800)

describe('no measurement means nothing changed', () => {
  /**
   * THE MOST IMPORTANT TEST IN THIS FILE. Coverage is an optional parameter
   * threaded through three functions, and the entire safety of C3 rests on the
   * claim that omitting it leaves the old behaviour byte for byte. Everything
   * that runs under vitest, and every angle whose measurement fails, takes this
   * path.
   */
  it('returns exactly what it returned before, for every sealed angle', () => {
    const scene = sceneWith(
      createObject('table.round', MIDDLE, venue),
      createObject('chair.x-white', at(2200, 900), venue),
      createObject('bar.resort-left', at(1900, 850), venue),
      createObject('plant.potted-2', at(2000, 950), venue),
    )
    for (const camera of cameras) {
      const before = selectRefs(scene, camera)
      const after = selectRefs(scene, camera, undefined)
      expect(after.refs, camera.id).toEqual(before.refs)
      expect(after.groups, camera.id).toEqual(before.groups)
      expect(after.warnings, camera.id).toEqual(before.warnings)
    }
  })

  it('leaves the groups with no coverage recorded at all', () => {
    const scene = sceneWith(createObject('table.round', MIDDLE, venue))
    for (const group of groupForRefs(scene, cam('s1'))) {
      // undefined, not 0: "nobody measured" and "measured, invisible" are
      // different states and byPriority reads the difference
      expect(group.coverage).toBeUndefined()
    }
  })
})

describe('a measurement removes what the camera cannot see', () => {
  /**
   * The user's own case: "יש זוויות שלא רואים … את האלמנטים ולכן ההחלטה לצרף
   * רפרנסים שלא נמצאים בתמונה נורא מבלבלת את המודל".
   *
   * Two products, so the room does not empty — an empty result is the safety
   * floor's business and is tested below. The chuppah is what keeps the frame
   * populated while the table disappears behind the louvered wall.
   */
  it('drops an occluded product from the references AND from the prose', () => {
    const table = createObject('table.round', MIDDLE, venue)
    const chuppah = createObject('chuppah.draped-white', at(2300, 950), venue)
    const scene = sceneWith(table, chuppah)

    const seen = composeExport(scene, 's1', { [table.id]: 0.08, [chuppah.id]: 0.2 })
    expect(seen.prompt).toContain('TABLES:')
    expect(seen.prompt).toContain('CHUPPAH:')

    // the same table, now measured as covering nothing — it is behind a wall
    const hidden = composeExport(scene, 's1', { [table.id]: 0, [chuppah.id]: 0.2 })
    // this is the pairing that matters: one measurement, both symptoms
    expect(hidden.prompt).not.toContain('TABLES:')
    expect(hidden.refs.map((r) => r.path)).not.toContain(
      seen.refs.find((r) => r.caption.includes('banquet table'))!.path,
    )
    // …and the chuppah, which IS visible, is untouched in both
    expect(hidden.prompt).toContain('CHUPPAH:')
  })

  it('keeps a group when one member of forty is visible, and keeps the count', () => {
    const tables = Array.from({ length: 40 }, (_, i) =>
      createObject('table.round', at(1200 + i * 40, 800), venue),
    )
    const scene = sceneWith(...tables)
    const inFrame = objectsInFrame(scene, cam('s1'))
    expect(inFrame.length).toBe(40)

    // exactly one of them peeks past the louvered wall
    const coverage: Coverage = Object.fromEntries(inFrame.map((o) => [o.id, 0]))
    coverage[tables[17].id] = 0.02

    const groups = groupForRefs(scene, cam('s1'), coverage)
    expect(groups).toHaveLength(1)
    /**
     * The count is what the ROOM holds, not what the difference pass could
     * resolve. Hiding one table of forty changes nothing where a second table
     * stands directly behind it, so a per-object cut would report three tables
     * in a frame that plainly shows forty — a worse lie than the one C3 removes.
     */
    expect(groups[0].count).toBe(40)
    expect(composeExport(scene, 's1', coverage).prompt).toContain('TABLES: forty')
    expect(selectRefs(scene, cam('s1'), coverage).refs.some((r) => r.role === 'design')).toBe(true)
  })

  it('drops the group only when every last member is invisible', () => {
    const tables = Array.from({ length: 6 }, (_, i) =>
      createObject('table.round', at(1200 + i * 60, 800), venue),
    )
    const anchor = createObject('chuppah.draped-white', at(2300, 950), venue)
    const scene = sceneWith(...tables, anchor)
    const coverage: Coverage = { [anchor.id]: 0.2 }
    for (const t of tables) coverage[t.id] = 0
    expect(groupForRefs(scene, cam('s1'), coverage).map((g) => g.catalogId)).toEqual([
      'chuppah.draped-white',
    ])
  })

  it('keeps a product sitting exactly on the threshold', () => {
    const table = createObject('table.round', MIDDLE, venue)
    // a second, plainly visible product so the safety floor stays out of it
    const anchor = createObject('chuppah.draped-white', at(2300, 950), venue)
    const scene = sceneWith(table, anchor)
    const ids = (c: Coverage) => selectRefs(scene, cam('s1'), c).groups.map((g) => g.catalogId)

    expect(ids({ [table.id]: MIN_COVERAGE_FRACTION, [anchor.id]: 0.2 })).toContain('table.round')
    expect(ids({ [table.id]: MIN_COVERAGE_FRACTION * 0.5, [anchor.id]: 0.2 })).not.toContain(
      'table.round',
    )
  })

  it('never resurrects something the frustum already rejected', () => {
    // s3 looks down +y from the centreline; this one is behind its back
    const behind = createObject('table.round', at(2200, -600), venue)
    const scene = sceneWith(behind)
    expect(selectRefs(scene, cam('s3'), { [behind.id]: 0.9 }).groups).toEqual([])
  })
})

describe('the safety floor', () => {
  /**
   * PLAN-05 C3 §5, and the highest-severity risk in the item. A dressed hall
   * that exports with three references and no TABLES line is a silent, total
   * failure of the package; one surplus reference costs a slot. When the
   * measurement claims a full room is empty, the measurement is what goes.
   */
  it('falls back to the frustum when a measurement empties a full room', () => {
    const scene = sceneWith(
      createObject('table.round', MIDDLE, venue),
      createObject('chair.x-white', at(2200, 900), venue),
    )
    const unmeasured = selectRefs(scene, cam('s1'))
    expect(unmeasured.groups.length).toBeGreaterThan(0)

    const collapsed = selectRefs(scene, cam('s1'), {})
    expect(collapsed.groups).toEqual(unmeasured.groups)
    expect(collapsed.refs).toEqual(unmeasured.refs)
    expect(collapsed.warnings.join(' ')).toContain('Visibility measurement found none')
  })

  it('says so out loud rather than degrading quietly', () => {
    const scene = sceneWith(createObject('table.round', MIDDLE, venue))
    const pkg = composeExport(scene, 's1', {})
    expect(pkg.warnings.join(' ')).toContain('it was discarded')
    // …and the package is still complete
    expect(pkg.prompt).toContain('TABLES:')
  })

  it('does not cry fallback over a room that really is empty', () => {
    const empty = selectRefs(sceneWith(), cam('s1'), {})
    expect(empty.groups).toEqual([])
    expect(empty.warnings.join(' ')).not.toContain('Visibility measurement found none')
  })

  it('does not cry fallback when the measurement merely thins the list', () => {
    const kept = createObject('table.round', MIDDLE, venue)
    const gone = createObject('chair.x-white', at(2200, 900), venue)
    const scene = sceneWith(kept, gone)
    const thinned = selectRefs(scene, cam('s1'), { [kept.id]: 0.06, [gone.id]: 0 })
    expect(thinned.groups.map((g) => g.catalogId)).toEqual(['table.round'])
    expect(thinned.warnings.join(' ')).not.toContain('Visibility measurement found none')
  })
})

describe('ranking inside a tier', () => {
  const twoTables = () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      createObject('table.round', at(1200 + i * 50, 800), venue),
    )
    const few = Array.from({ length: 2 }, (_, i) =>
      createObject('table.square', at(2600 + i * 50, 800), venue),
    )
    return { many, few, scene: sceneWith(...many, ...few) }
  }

  it('ranks by count when nothing was measured, exactly as before', () => {
    const { scene } = twoTables()
    const order = groupForRefs(scene, cam('s1')).map((g) => g.catalogId)
    expect(order.indexOf('table.round')).toBeLessThan(order.indexOf('table.square'))
  })

  it('ranks by share of the frame once there is a measurement', () => {
    const { many, few, scene } = twoTables()
    // twelve small ones tucked at the back; two that fill the foreground
    const coverage: Coverage = {}
    for (const o of many) coverage[o.id] = 0.002
    for (const o of few) coverage[o.id] = 0.2

    const groups = groupForRefs(scene, cam('s1'), coverage)
    const order = groups.map((g) => g.catalogId)
    expect(order.indexOf('table.square')).toBeLessThan(order.indexOf('table.round'))
    // the counts are untouched — only the ORDER moved
    expect(groups.find((g) => g.catalogId === 'table.round')!.count).toBe(12)
    expect(groups.find((g) => g.catalogId === 'table.square')!.count).toBe(2)
  })

  it('sums a group’s members rather than taking one of them', () => {
    const { many, scene } = twoTables()
    const coverage: Coverage = {}
    for (const o of many) coverage[o.id] = 0.01
    const round = groupForRefs(scene, cam('s1'), coverage).find(
      (g) => g.catalogId === 'table.round',
    )!
    expect(round.coverage).toBeCloseTo(0.12, 6)
  })

  it('never lets coverage jump a product over its tier', () => {
    // a chuppah is tier 0 and a table is tier 3; a huge table must not outrank it
    const chuppah = createObject('chuppah.draped-white', at(2200, 900), venue)
    const table = createObject('table.round', MIDDLE, venue)
    const scene = sceneWith(chuppah, table)
    const order = groupForRefs(scene, cam('s1'), {
      [chuppah.id]: 0.005,
      [table.id]: 0.5,
    }).map((g) => g.entry.category)
    expect(order[0]).toBe('chuppah')
  })
})
