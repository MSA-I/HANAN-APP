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
import {
  addObject,
  canReplaceObject,
  newProject,
  replaceObject,
  setChuppahLocation,
  uniqueBlocker,
} from './actions'
import { objectAABB } from './selectors'
import { useEditorStore } from './store'
import { getVenuePack } from '../core/venuePacks'
import { getCatalogEntry } from '../core/catalog/registry'
import { chuppahEntries } from '../core/catalog/entries/chuppah'
import { allowedOnDeck, checkPlacement } from '../core/layout/collision'
import { isZoneInside } from '../core/layout/zoneOccupancy'

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
    // ⚠ PLAN-03 made this conditional, and that is the FIX and not a caveat: the
    // canopy may stay up here because the deck has a ceremony pad of its own, and
    // with "חופה למטה" it has not. See the pair below.
    setChuppahLocation('reception')
    const id = addObject('chuppah.draped-white', centre)
    expect(insideDeck(id)).toBe(true)
  })

  /**
   * §2.4 bug ב, and it is the one the switch would have left behind. Until
   * PLAN-03 `allowedOnDeck` said `entry.zoneKind === 'chuppah'` unconditionally,
   * so the deck branch of `clampToVenue` ran FIRST, clamped the canopy into the
   * deck and `continue`d — the home snap was never reached. The result was a
   * canopy stranded on a deck with no ceremony pad on it, which is the exact
   * inverse of what "חופה למטה" asks for.
   */
  it('sends a chuppah dropped on the deck DOWN to the hall while the ceremony is there', () => {
    setChuppahLocation('hall')
    const id = addObject('chuppah.draped-white', centre)
    expect(overlapsDeck(id)).toBe(false)
    const hallPad = pack.restricted!.find((z) => z.kind === 'chuppah' && !isZoneInside(z, DECK))!
    const b = objectAABB(scene(), id)!
    expect(b.minX).toBeLessThan(hallPad.x + hallPad.width)
    expect(b.maxX).toBeGreaterThan(hallPad.x)
  })

  it('is the whitelist itself that swings, not a special case downstream', () => {
    const canopy = getCatalogEntry('chuppah.draped-white')
    expect(allowedOnDeck(canopy, true)).toBe(true)
    expect(allowedOnDeck(canopy, false)).toBe(false)
    // and nothing else on the list moves with it
    for (const id of ['table.round', 'buffet.table', 'chair.x-white']) {
      expect(allowedOnDeck(getCatalogEntry(id), true)).toBe(
        allowedOnDeck(getCatalogEntry(id), false),
      )
    }
  })

  it('keeps chairs on the deck', () => {
    const id = addObject('chair.x-white', centre)
    expect(insideDeck(id)).toBe(true)
  })

  it('keeps a buffet table on the deck', () => {
    const id = addObject('buffet.table', centre)
    expect(insideDeck(id)).toBe(true)
  })

  /**
   * REVERSED in round 2 (corrections §27): this asserted that a round table was
   * pushed off the deck. The user's complaint is that exact behaviour — "when I try
   * to place tables or a chuppah in the reception area, even when it is switched on,
   * it will not let me" — so guest tables joined the whitelist and a table dropped
   * up here now stays, clamped in like the buffet.
   */
  it('keeps a round table on the deck (§27)', () => {
    const id = addObject('table.round', centre)
    expect(insideDeck(id)).toBe(true)
  })

  it('pushes a bar unit off the deck — a fixed station belongs to its own zone', () => {
    const id = addObject('bar.resort-left', centre)
    expect(overlapsDeck(id)).toBe(false)
  })

  /**
   * The half of the deck story that lived in the RAY, not in the rules.
   *
   * Placing on the deck in 3D did nothing at all: `Placement3D` built one pick
   * plane at 0.005 m, so a click aimed at the +4.70 m deck was measured on the hall
   * floor and landed metres past x = 6051 → `outOfBounds` → `commitPlacement3D`
   * returned false, silently. Everything below already answered correctly, which is
   * the tell — so what this pins is that the ANSWER was never the problem, and that
   * it stays right now that a plane exists at the deck's own height to ask it from.
   */
  describe('what the ghost is told once the ray reaches the deck', () => {
    const deckPad = pack.restricted!.find((z) => z.kind === 'chuppah' && isZoneInside(z, DECK))!
    const padCentre = { x: deckPad.x + deckPad.width / 2, y: deckPad.y + deckPad.depth / 2 }
    /** exactly the question `resolvePlacement` asks before it paints the ghost */
    const judge = (catalogId: string, position: { x: number; y: number }) => {
      const entry = getCatalogEntry(catalogId)
      return checkPlacement(scene(), {
        catalogId,
        transform: { position, rotation: entry.defaultRotation ?? 0, elevation: 0 },
        size: entry.defaultSize,
      })
    }

    it('paints a guest table GREEN over the middle of the deck', () => {
      expect(judge('table.round', centre)).toEqual([])
      expect(insideDeck(addObject('table.round', centre))).toBe(true)
    })

    /**
     * Left blocking on purpose: 24.3 m² of a 293 m² deck, and it is the ceremony
     * pad the user drew himself. What changed is that the refusal is now VISIBLE —
     * a red ghost carrying this violation — instead of a click that did nothing.
     */
    it('still refuses one that reaches the deck ceremony pad, and says which zone', () => {
      // ⚠ PLAN-03 test 13: the pad has to BE there to refuse anything, so the
      // scenario names its ceremony instead of inheriting it.
      setChuppahLocation('reception')
      expect(deckPad.elevation).toBeGreaterThan(DECK.elevation!)
      expect(judge('table.round', padCentre)).toContainEqual({
        kind: 'forbiddenZone',
        zone: 'chuppah',
      })
    })

    /**
     * PLAN-03 test 12, and the whole feature in one assertion: with the ceremony
     * downstairs that rectangle is not in the list at all, so the deck is plain
     * deck there and a guest table is welcome on it. The refusal above and the
     * green here are the same rule read at its two settings.
     */
    it('welcomes that same table on the same spot once the ceremony is downstairs', () => {
      setChuppahLocation('hall')
      expect(judge('table.round', padCentre)).toEqual([])
    })

    it('lets the canopy itself stand on that pad', () => {
      setChuppahLocation('reception')
      expect(judge('chuppah.draped-white', padCentre)).toEqual([])
    })
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
    setChuppahLocation('reception')
    const onDeck = addObject('chuppah.acrylic', centre)
    expect(insideDeck(onDeck)).toBe(true)
    expect(addObject('chuppah.draped-blush', { x: 300, y: 300 })).toBe(onDeck)
    expect(placed()).toHaveLength(1)
  })

  /**
   * The other half of round-2 §27, kept as a test so the finding does not get lost:
   * "it will not let me place a chuppah in the reception area" is NOT a zone rule.
   * The deck has always let a chuppah in — the whitelist named it first — and what
   * the user actually hit is the one-per-event tag, which refuses the second canopy
   * in the hall exactly as flatly as on the deck. Widening the deck rule would have
   * changed nothing; only deleting the first chuppah does.
   */
  it('shows that `unique`, not the deck, is what refuses a chuppah there (§27)', () => {
    setChuppahLocation('reception')
    const onDeck = addObject('chuppah.draped-white', centre)
    expect(insideDeck(onDeck)).toBe(true)
    expect(uniqueBlocker(scene(), 'chuppah.round-beige')?.id).toBe(onDeck)
    expect(addObject('chuppah.round-beige', centre)).toBe(onDeck)
    expect(addObject('chuppah.round-beige', { x: 300, y: 300 })).toBe(onDeck)
    // `placed()`, not Object.keys: the resort seeds three frozen bar fittings into
    // every scene, so the raw object count is 4 here and says nothing about canopies
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
