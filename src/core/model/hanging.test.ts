/**
 * Ceiling placement is the only thing in the app that seeds a non-zero
 * elevation at creation time, and it depends on the venue — so it is worth
 * pinning down: the item's TOP meets the ceiling, and it stays a top-level
 * object rather than becoming an attached child like table decor.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry, listCatalog } from '../catalog/registry'
import { createObject, DEFAULT_WALL_HEIGHT } from './factory'

const at = { x: 100, y: 100 }

describe('ceiling placement', () => {
  it('hangs the item so its top meets the ceiling of a pack hall', () => {
    const entry = getCatalogEntry('lamp.pendant')
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160 })
    expect(obj.transform.elevation).toBe(1160 - entry.defaultSize.height)
    expect(obj.transform.elevation + obj.size.height).toBe(1160)
  })

  it('scales the drop to whatever ceiling it is given', () => {
    expect(createObject('lamp.pendant-cluster', at, { wallHeight: 350 }).transform.elevation).toBe(290)
    expect(createObject('lamp.pendant-cluster', at, { wallHeight: 1160 }).transform.elevation).toBe(1100)
  })

  it('assumes a procedural room when no venue is passed', () => {
    const obj = createObject('lamp.pendant', at)
    expect(obj.transform.elevation).toBe(DEFAULT_WALL_HEIGHT - 50)
  })

  // The resort's roof apex is 1160 but its lighting truss sits at 895 — hung
  // items pin their top to the truss (hangHeight), not the ceiling.
  it('hangs from the pack hangHeight, not wallHeight, when the pack defines one', () => {
    const obj = createObject('lamp.chandelier-diamond', at, { wallHeight: 1160, venuePackId: 'resort' })
    expect(obj.transform.elevation).toBe(895 - 90)
    expect(obj.transform.elevation + obj.size.height).toBe(895)
  })

  it('falls back to wallHeight for an unknown pack id', () => {
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160, venuePackId: 'no-such-pack' })
    expect(obj.transform.elevation).toBe(1110)
  })

  it('stays a top-level object, not an attached child', () => {
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160 })
    expect(obj.parentId).toBeNull()
    expect(obj.attachment).toBeUndefined()
  })

  // A chandelier is the tallest thing that hangs; in the 350 cm procedural room
  // the 120 cm candelabra must still clear head height rather than go negative.
  it('keeps the tallest chandelier above the floor in a low room', () => {
    const obj = createObject('lamp.chandelier-candelabra', at, { wallHeight: 350 })
    expect(obj.transform.elevation).toBe(230)
    expect(obj.transform.elevation).toBeGreaterThan(200)
  })
})

describe('chandelier entries', () => {
  const ids = ['lamp.chandelier-diamond', 'lamp.chandelier-basket', 'lamp.chandelier-candelabra']

  it.each(ids)('%s hangs from the ceiling', (id) => {
    expect(getCatalogEntry(id).placement).toBe('ceiling')
  })

  it.each(ids)('%s drops between 60 and 120 cm', (id) => {
    const h = getCatalogEntry(id).defaultSize.height
    expect(h).toBeGreaterThanOrEqual(60)
    expect(h).toBeLessThanOrEqual(120)
  })

  // guards the real-inventory principle: 7 source GLBs collapsed to 3 products
  it('has exactly three chandeliers', () => {
    expect(listCatalog().filter((e) => e.id.startsWith('lamp.chandelier-'))).toHaveLength(3)
  })
})

describe('every other placement still starts on the floor', () => {
  it.each(['plant.potted', 'lamp.arc-crystal', 'decor.vase-ceramic'])('%s', (id) => {
    expect(createObject(id, at, { wallHeight: 1160 }).transform.elevation).toBe(0)
  })
})
