/**
 * Zone-locking, from the chuppah's side. The bar and DJ booth already cover the
 * happy path in store.test.ts, but the chuppah zone is the one that can fail in
 * ways theirs cannot:
 *
 *  - it sits ENTIRELY inside the pool zone (pool x[766,3962] y[1408,2544]
 *    swallows chuppah x[1809,2569] y[1651,2076]), so if clampToVenue ever stops
 *    short-circuiting after the home-zone snap, every chuppah gets shoved out of
 *    the pool and therefore out of its own zone;
 *  - `zoneKind` is matched by string. A typo does not mean "places freely", it
 *    means the object is pushed out of every restricted zone — so the entries
 *    are checked against the pack's real zone kinds, not against a literal;
 *  - these are the largest objects in the catalog, and the zone is only 425 deep,
 *    so "fits" is a claim worth asserting rather than assuming.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../catalog/registry'
import { chuppahEntries } from '../catalog/entries/chuppah'
import { getVenuePack } from '../venuePacks'
import { addObject, moveObjectsBy, newProject, rotateObjectsBy } from '../../state/actions'
import { objectAABB } from '../../state/selectors'
import { useEditorStore } from '../../state/store'

const scene = () => useEditorStore.getState().scene
const entries = chuppahEntries
const ids = entries.map((e) => e.id)

/** VenuePack.restricted is optional, so read it through one place. */
const zones = () => getVenuePack('resort')?.restricted ?? []
const ZONE = zones().find((z) => z.kind === 'chuppah')!
const inZone = (id: string) => {
  const b = objectAABB(scene(), id)!
  return (
    b.minX >= ZONE.x - 0.01 &&
    b.maxX <= ZONE.x + ZONE.width + 0.01 &&
    b.minY >= ZONE.y - 0.01 &&
    b.maxY <= ZONE.y + ZONE.depth + 0.01
  )
}

// The four corners of the resort floor, plus one point deep inside the pool.
// Stored as tuples and rebuilt per call so every placement is an independent
// value, matching the fresh pointer coordinates supplied by the editor.
const CORNERS: [number, number][] = [
  [0, 0],
  [4423, 0],
  [0, 2544],
  [4423, 2544],
  [2500, 2000],
]

beforeEach(() => {
  newProject({ name: 'resort', venuePackId: 'resort' })
})

describe('the chuppah group', () => {
  it('is not empty — these are the first structure entries', () => {
    expect(ids.length).toBeGreaterThan(0)
  })

  // Matching against the pack rather than the literal 'chuppah' is the point:
  // it fails the same way whether the entry or the zone is the one misspelt.
  it.each(ids)('%s declares a zoneKind the resort pack actually has', (id) => {
    const kinds = zones().map((z) => z.kind)
    expect(kinds).toContain(getCatalogEntry(id).zoneKind)
    expect(getCatalogEntry(id).zoneKind).toBe(ZONE.kind)
  })

  it.each(ids)('%s fits inside the %s zone', (id) => {
    const { width, depth } = getCatalogEntry(id).defaultSize
    expect(width).toBeLessThanOrEqual(ZONE.width)
    expect(depth).toBeLessThanOrEqual(ZONE.depth)
  })

  it.each(ids)('%s stands on the floor, not the ceiling', (id) => {
    expect(getCatalogEntry(id).placement ?? 'floor').toBe('floor')
  })
})

describe('chuppah zone lock', () => {
  it('does not retain or freeze the caller-owned drop position', () => {
    const drop = { x: 0, y: 0 }
    addObject(ids[0], drop)
    expect(Object.isFrozen(drop)).toBe(false)

    drop.x = 4423
    expect(inZone(addObject(ids[0], drop))).toBe(true)
  })

  it.each(ids)('%s teleports into the zone from any corner of the resort', (id) => {
    for (const [x, y] of CORNERS) {
      newProject({ name: 'resort', venuePackId: 'resort' })
      expect(inZone(addObject(id, { x, y }))).toBe(true)
    }
  })

  it.each(ids)('%s can never be dragged out', (id) => {
    const objId = addObject(id, { x: 300, y: 300 })
    moveObjectsBy([objId], { x: -3000, y: -3000 })
    expect(inZone(objId)).toBe(true)
    moveObjectsBy([objId], { x: 9999, y: 9999 })
    expect(inZone(objId)).toBe(true)
  })

  it.each(ids)('%s stays inside after a quarter turn', (id) => {
    const objId = addObject(id, { x: 4000, y: 200 })
    rotateObjectsBy([objId], 90)
    expect(inZone(objId)).toBe(true)
    rotateObjectsBy([objId], 90)
    expect(inZone(objId)).toBe(true)
  })

  // Wide rectangular chuppot cannot fit the shallow zone diagonally. The clamp
  // snaps only those impossible rotations to a quarter turn; round and narrow
  // entries keep their arbitrary angle.
  it.each(ids)(
    '%s stays inside at arbitrary requested angles',
    (id) => {
      const objId = addObject(id, { x: 0, y: 2544 })
      for (const deg of [17, 45, 63, 120]) {
        rotateObjectsBy([objId], deg)
        expect(inZone(objId)).toBe(true)
      }
    },
  )

  // The regression this file exists for: the chuppah rect lies wholly within the
  // pool rect, so the home-zone snap has to win over the pool's push-out.
  it.each(ids)('%s is not pushed out by the pool zone it sits inside', (id) => {
    const objId = addObject(id, { x: 2200, y: 1800 }) // inside both rects
    const b = objectAABB(scene(), objId)!
    expect(inZone(objId)).toBe(true)
    // still overlapping the pool — proof it was not evicted
    expect(b.minX < 3962 && b.maxX > 766 && b.minY < 2544 && b.maxY > 1408).toBe(true)
  })

  it('places freely in a procedural room, which has no chuppah zone', () => {
    newProject({ name: 'plain', venueWidth: 2400, venueDepth: 1600 })
    const objId = addObject(ids[0], { x: 700, y: 700 })
    expect(scene().objects[objId].transform.position).toEqual({ x: 700, y: 700 })
  })
})
