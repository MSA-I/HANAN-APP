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
 *  - the 1.5× real-world scale makes some models deeper than the 425cm marker, so
 *    oversized axes must stay centred while smaller axes remain clamped inside.
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
/**
 * Since the 2026-07-28 re-import a chuppah has TWO legal homes: the hall's
 * ceremony rectangle and the raised reception deck (source doc §43 — one canopy
 * per event, either place). The deck now occupies the plan's east end, so a drop
 * at the far corner legitimately settles up there rather than teleporting back
 * to the hall. Tests that only care "did it land in a home zone" use
 * `settledOnAHome`; the ones about the hall zone specifically still use
 * `settledOnZone`.
 */
const DECK = zones().find((z) => z.kind === 'kabalatPanim')
const settledIn = (id: string, zone: { x: number; y: number; width: number; depth: number }) => {
  const b = objectAABB(scene(), id)!
  const settled = (min: number, max: number, zoneMin: number, zoneSize: number) =>
    max - min > zoneSize
      ? Math.abs((min + max) / 2 - (zoneMin + zoneSize / 2)) < 0.01
      : min >= zoneMin - 0.01 && max <= zoneMin + zoneSize + 0.01
  return settled(b.minX, b.maxX, zone.x, zone.width) && settled(b.minY, b.maxY, zone.y, zone.depth)
}
const settledOnZone = (id: string) => settledIn(id, ZONE)
const settledOnAHome = (id: string) => settledOnZone(id) || (!!DECK && settledIn(id, DECK))

const SCALED_SIZES = [
  ['chuppah.draped-white', 522, 520.5, 397.5],
  ['chuppah.draped-blush', 508.5, 490.5, 405],
  ['chuppah.ruched-ivory', 474, 433.5, 405],
  ['chuppah.acrylic', 523.5, 421.5, 405],
  ['chuppah.frame-chrome', 375, 243, 420],
  ['chuppah.round-white', 507, 507, 382.5],
  ['chuppah.round-beige', 403.5, 403.5, 397.5],
  ['chuppah.arch-lattice', 444, 318, 435],
] as const

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

  it.each(SCALED_SIZES)('%s uses the requested 1.5× size', (id, width, depth, height) => {
    const entry = getCatalogEntry(id)
    expect(entry.defaultSize).toEqual({ width, depth, height })
    expect(entry.modelScale).toBe(1.5)
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
    expect(settledOnAHome(addObject(ids[0], drop))).toBe(true)
  })

  it.each(ids)('%s teleports into a home zone from any corner of the resort', (id) => {
    for (const [x, y] of CORNERS) {
      newProject({ name: 'resort', venuePackId: 'resort' })
      expect(settledOnAHome(addObject(id, { x, y }))).toBe(true)
    }
  })

  it.each(ids)('%s never ends up loose on the floor, however far it is dragged', (id) => {
    const objId = addObject(id, { x: 300, y: 300 })
    moveObjectsBy([objId], { x: -3000, y: -3000 })
    // dragged west, away from the deck — the hall zone is the only home in reach
    expect(settledOnZone(objId)).toBe(true)
    moveObjectsBy([objId], { x: 9999, y: 9999 })
    expect(settledOnAHome(objId)).toBe(true)
  })

  it.each(ids)('%s stays anchored after a quarter turn', (id) => {
    const objId = addObject(id, { x: 4000, y: 200 })
    rotateObjectsBy([objId], 90)
    expect(settledOnZone(objId)).toBe(true)
    rotateObjectsBy([objId], 90)
    expect(settledOnZone(objId)).toBe(true)
  })

  // Structures that cannot fit the shallow zone at the requested angle snap to
  // a quarter turn; any oversized axis stays centred on the marker.
  it.each(ids)(
    '%s stays anchored at arbitrary requested angles',
    (id) => {
      const objId = addObject(id, { x: 0, y: 2544 })
      for (const deg of [17, 45, 63, 120]) {
        rotateObjectsBy([objId], deg)
        expect(settledOnZone(objId)).toBe(true)
      }
    },
  )

  // The regression this file exists for: the chuppah rect lies wholly within the
  // pool rect, so the home-zone snap has to win over the pool's push-out.
  it.each(ids)('%s is not pushed out by the pool zone it sits inside', (id) => {
    const objId = addObject(id, { x: 2200, y: 1800 }) // inside both rects
    const b = objectAABB(scene(), objId)!
    expect(settledOnZone(objId)).toBe(true)
    // still overlapping the pool — proof it was not evicted
    expect(b.minX < 3962 && b.maxX > 766 && b.minY < 2544 && b.maxY > 1408).toBe(true)
  })

  it('places freely in a procedural room, which has no chuppah zone', () => {
    newProject({ name: 'plain', venueWidth: 2400, venueDepth: 1600 })
    const objId = addObject(ids[0], { x: 700, y: 700 })
    expect(scene().objects[objId].transform.position).toEqual({ x: 700, y: 700 })
  })
})
