/**
 * The reception deck and the one-chuppah rule (source doc §41, §42, §43).
 *
 * The deck is the first INVERTED restricted zone: every other zone pushes
 * furniture out, this one lets a whitelist in and pushes the rest out. Two things
 * make it easy to break silently:
 *
 *  - a chuppah carries `zoneKind: 'chuppah'`, so the home-zone snap would drag it
 *    back down to the hall's ceremony rectangle unless the deck is checked first;
 *  - the deck sits at x 4432…6051, past the hall's own 4423 — so it only works at
 *    all because the pack's `size` was widened to cover it. A test that hard-codes
 *    the rectangle would keep passing after someone narrows `size` again, so the
 *    numbers here are read from the pack.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { addObject, newProject, replaceObject, canReplaceObject, uniqueBlocker } from './actions'
import { objectAABB } from './selectors'
import { useEditorStore } from './store'
import { getVenuePack } from '../core/venuePacks'
import { getCatalogEntry } from '../core/catalog/registry'
import { chuppahEntries } from '../core/catalog/entries/chuppah'

const scene = () => useEditorStore.getState().scene
/**
 * What the EVENT contains. A resort project is seeded with the hall's own baked
 * fixtures (core/venueFixtures.ts — the bar), so counting `scene().objects` counts
 * those too and says nothing about how many chuppot were placed.
 */
const placed = () => Object.values(scene().objects).filter((o) => !o.flags.frozen)
const pack = getVenuePack('resort')!
const DECK = pack.restricted!.find((z) => z.kind === 'kabalatPanim')!
const centre = { x: DECK.x + DECK.width / 2, y: DECK.y + DECK.depth / 2 }

const insideDeck = (id: string) => {
  const b = objectAABB(scene(), id)!
  // an item wider than the deck is centred on it instead — same rule zoneShift uses
  const held = (min: number, max: number, zMin: number, zSize: number) =>
    max - min > zSize
      ? Math.abs((min + max) / 2 - (zMin + zSize / 2)) < 0.01
      : min >= zMin - 0.01 && max <= zMin + zSize + 0.01
  return held(b.minX, b.maxX, DECK.x, DECK.width) && held(b.minY, b.maxY, DECK.y, DECK.depth)
}

const overlapsDeck = (id: string) => {
  const b = objectAABB(scene(), id)!
  return b.minX < DECK.x + DECK.width && b.maxX > DECK.x && b.minY < DECK.y + DECK.depth && b.maxY > DECK.y
}

beforeEach(() => {
  newProject({ name: 'קבלת פנים', venueWidth: pack.size.width, venueDepth: pack.size.depth, venuePackId: 'resort' })
})

describe('the reception deck exists in the plan at all', () => {
  it('is inside the venue rectangle — otherwise nothing can ever be placed on it', () => {
    expect(DECK.x + DECK.width).toBeLessThanOrEqual(pack.size.width)
    expect(DECK.y + DECK.depth).toBeLessThanOrEqual(pack.size.depth)
  })

  it('is raised, and says so', () => {
    expect(DECK.elevation).toBe(470)
  })

  it('has exactly two sealed camera angles, and the hall has five', () => {
    const cams = pack.cameras ?? []
    expect(cams.filter((c) => c.zone === 'kabalatPanim')).toHaveLength(2)
    expect(cams.filter((c) => !c.zone)).toHaveLength(5)
  })

  it('both reception angles stand at eye level ABOVE the deck, not on the hall floor', () => {
    for (const cam of (pack.cameras ?? []).filter((c) => c.zone === 'kabalatPanim')) {
      const aboveDeck = cam.position[1] - DECK.elevation! / 100
      expect(aboveDeck).toBeGreaterThan(1.4)
      expect(aboveDeck).toBeLessThan(2.0)
    }
  })
})

describe('the whitelist — what may stand on the deck', () => {
  it('keeps a chuppah dropped on the deck there, instead of snapping it to the hall zone', () => {
    const id = addObject('chuppah.draped-white', centre)
    expect(insideDeck(id)).toBe(true)
  })

  it('keeps chairs on the deck', () => {
    const id = addObject('chair.x-white', centre)
    expect(insideDeck(id)).toBe(true)
  })

  it('keeps a buffet table on the deck', () => {
    const id = addObject('buffet.table', centre)
    expect(insideDeck(id)).toBe(true)
  })

  it('pushes a round table off the deck entirely', () => {
    const id = addObject('table.round', centre)
    expect(overlapsDeck(id)).toBe(false)
  })

  it('pushes a bar unit off the deck — a fixed station belongs to its own zone', () => {
    const id = addObject('bar.straight', centre)
    expect(overlapsDeck(id)).toBe(false)
  })

  it('a chuppah dropped in the HALL still lands in the hall ceremony zone', () => {
    const hallZone = pack.restricted!.find((z) => z.kind === 'chuppah')!
    const id = addObject('chuppah.draped-white', { x: 300, y: 300 })
    const b = objectAABB(scene(), id)!
    expect(b.minX).toBeLessThan(hallZone.x + hallZone.width)
    expect(b.maxX).toBeGreaterThan(hallZone.x)
    expect(overlapsDeck(id)).toBe(false)
  })
})

describe('one chuppah per event (§43)', () => {
  it('tags all eight chuppot with the same exclusivity marker', () => {
    for (const entry of chuppahEntries) expect(entry.unique).toBe('chuppah')
  })

  it('refuses a second chuppah — including a different model, in a different zone', () => {
    const first = addObject('chuppah.draped-white', { x: 300, y: 300 })
    expect(placed()).toHaveLength(1)
    const second = addObject('chuppah.round-beige', centre)
    expect(placed()).toHaveLength(1)
    // the refusal hands back the one already placed, and selects it
    expect(second).toBe(first)
    expect(useEditorStore.getState().selection).toEqual([first])
  })

  it('blocks the hall once the deck has the chuppah, and the other way round', () => {
    const onDeck = addObject('chuppah.acrylic', centre)
    expect(insideDeck(onDeck)).toBe(true)
    expect(addObject('chuppah.draped-blush', { x: 300, y: 300 })).toBe(onDeck)
    expect(placed()).toHaveLength(1)
  })

  it('still allows swapping the chuppah for another model in place', () => {
    const id = addObject('chuppah.draped-white', { x: 300, y: 300 })
    expect(canReplaceObject(scene(), id, 'chuppah.round-white')).toBe(true)
    expect(replaceObject(id, 'chuppah.round-white')).toBe(true)
    expect(scene().objects[id].catalogId).toBe('chuppah.round-white')
    expect(placed()).toHaveLength(1)
  })

  it('refuses to turn a SECOND object into a chuppah', () => {
    addObject('chuppah.draped-white', { x: 300, y: 300 })
    const table = addObject('table.round', { x: 500, y: 500 })
    expect(canReplaceObject(scene(), table, 'chuppah.round-white')).toBe(false)
    expect(replaceObject(table, 'chuppah.round-white')).toBe(false)
    expect(scene().objects[table].catalogId).toBe('table.round')
  })

  it('leaves untagged items alone — many tables are fine', () => {
    expect(getCatalogEntry('table.round').unique).toBeUndefined()
    addObject('table.round', { x: 300, y: 300 })
    addObject('table.round', { x: 900, y: 300 })
    expect(uniqueBlocker(scene(), 'table.round')).toBeNull()
    expect(Object.values(scene().objects).filter((o) => o.catalogId === 'table.round')).toHaveLength(2)
  })
})
