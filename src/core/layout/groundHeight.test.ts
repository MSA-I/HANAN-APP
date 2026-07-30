/**
 * Every number that describes the building is read off the live pack and the live
 * catalogue, never written down here (AGENT-BRIEF §1.7). A frozen 470 in this file
 * would keep passing while the deck moved underneath it — which is how round 2
 * lost two rounds (c43d989, e71297c, ef838ed).
 *
 * The plain rectangles in the first block are the opposite case: they are the
 * function's OWN contract, not facts about the resort, so they are literals.
 */
import { describe, expect, it } from 'vitest'
import { listCatalog } from '../catalog/registry'
import { getVenuePack } from '../venuePacks'
import { groundHeightAt, standingHeightAt, type GroundZone } from './groundHeight'
import { isPointInZone, isZoneInside } from './zoneOccupancy'

const centre = (z: GroundZone) => ({ x: z.x + z.width / 2, y: z.y + z.depth / 2 })

describe('groundHeightAt — the contract', () => {
  const RAISED: GroundZone = { x: 100, y: 100, width: 200, depth: 200, elevation: 50 }

  it('is ground level where nothing is declared', () => {
    expect(groundHeightAt({ x: 150, y: 150 }, [])).toBe(0)
    expect(groundHeightAt({ x: 1000, y: 1000 }, [RAISED])).toBe(0)
  })

  it('ignores a rectangle that declares no level', () => {
    const noLevel: GroundZone = { x: 0, y: 0, width: 1000, depth: 1000 }
    expect(groundHeightAt({ x: 150, y: 150 }, [noLevel])).toBe(0)
    // and it does not shadow one that does declare
    expect(groundHeightAt({ x: 150, y: 150 }, [noLevel, RAISED])).toBe(RAISED.elevation)
  })

  it('includes the boundary, like every other zone test', () => {
    expect(groundHeightAt({ x: RAISED.x, y: RAISED.y }, [RAISED])).toBe(RAISED.elevation)
    expect(groundHeightAt({ x: RAISED.x + RAISED.width, y: RAISED.y }, [RAISED])).toBe(RAISED.elevation)
  })

  it('takes the highest of two overlapping levels, in either declaration order', () => {
    const riser: GroundZone = { x: 150, y: 150, width: 50, depth: 50, elevation: 80 }
    expect(groundHeightAt({ x: 170, y: 170 }, [RAISED, riser])).toBe(riser.elevation)
    expect(groundHeightAt({ x: 170, y: 170 }, [riser, RAISED])).toBe(riser.elevation)
  })

  it('reports a level BELOW the floor rather than folding it away', () => {
    const pit: GroundZone = { x: 0, y: 0, width: 100, depth: 100, elevation: -30 }
    expect(groundHeightAt({ x: 50, y: 50 }, [pit])).toBe(-30)
  })
})

describe('groundHeightAt — the resort', () => {
  const zones = getVenuePack('resort')!.restricted!
  const deck = zones.find((z) => z.kind === 'kabalatPanim')!
  const deckPad = zones.find((z) => z.kind === 'chuppah' && isZoneInside(z, deck))!
  const hallPad = zones.find((z) => z.kind === 'chuppah' && !isZoneInside(z, deck))!
  const pool = zones.find((z) => z.kind === 'pool')!

  it('puts a point on the reception deck at the deck level', () => {
    expect(deck.elevation).toBeGreaterThan(0)
    expect(groundHeightAt(centre(deck), zones)).toBe(deck.elevation)
  })

  /** The nesting the overlap rule was written for — and it is a real one. */
  it('puts the deck ceremony pad ABOVE the deck it stands on', () => {
    expect(isPointInZone(centre(deckPad), deck)).toBe(true)
    expect(deckPad.elevation).toBeGreaterThan(deck.elevation!)
    expect(groundHeightAt(centre(deckPad), zones)).toBe(deckPad.elevation)
  })

  /** The second nesting: a declared level inside a rectangle that declares none. */
  it('lifts the hall ceremony pad out of the pool rectangle around it', () => {
    expect(isZoneInside(hallPad, pool)).toBe(true)
    expect(pool.elevation).toBeUndefined()
    expect(groundHeightAt(centre(hallPad), zones)).toBe(hallPad.elevation)
  })

  it('leaves the hall floor at zero', () => {
    const hallFloor = { x: 300, y: 300 }
    expect(zones.some((z) => isPointInZone(hallFloor, z))).toBe(false)
    expect(groundHeightAt(hallFloor, zones)).toBe(0)
  })

  /**
   * The edge that the 3D pick surfaces are built from: one mesh per level, sized to
   * that level's rectangle. Just OUTSIDE the deck the answer has to fall straight
   * back to 0 — a plane that over-reached its zone would let a click land 4.70 m
   * above ground on paving, which is the same class of fault as the one being fixed
   * only in the other direction.
   */
  it('drops back to the hall floor one centimetre outside the deck', () => {
    const justOutside = { x: deck.x - 1, y: deck.y + deck.depth / 2 }
    expect(isPointInZone(justOutside, deck)).toBe(false)
    expect(groundHeightAt(justOutside, zones)).toBe(0)
    // and the deck edge itself is still deck — the boundary is inclusive
    expect(groundHeightAt({ x: deck.x, y: justOutside.y }, zones)).toBe(deck.elevation)
  })
})

/**
 * `standingHeightAt` is the rule the renderer and the ghost share. Both halves
 * matter: the deck case is the report being fixed, and the `zoneKind` cases are
 * the regression — every chuppah, bar unit and DJ booth placed in round 1 has to
 * come out at exactly the height it comes out at today.
 */
describe('standingHeightAt', () => {
  const zones = getVenuePack('resort')!.restricted!
  const deck = zones.find((z) => z.kind === 'kabalatPanim')!
  const deckPad = zones.find((z) => z.kind === 'chuppah' && isZoneInside(z, deck))!
  const hallPad = zones.find((z) => z.kind === 'chuppah' && !isZoneInside(z, deck))!
  const barZone = zones.find((z) => z.kind === 'bar')!

  const chair = listCatalog().find((e) => e.category === 'seating' && !e.zoneKind)!
  const canopy = listCatalog().find((e) => e.zoneKind === 'chuppah')!
  const barUnit = listCatalog().find((e) => e.zoneKind === 'bar')!
  const booth = listCatalog().find((e) => e.zoneKind === 'dj')!
  const pendant = listCatalog().find((e) => e.placement === 'ceiling')!

  it('stands a chair on the reception deck, not 4.70 m under it', () => {
    expect(standingHeightAt(chair, centre(deck), zones)).toBe(deck.elevation)
  })

  it('leaves the same chair on the floor in the hall', () => {
    expect(standingHeightAt(chair, { x: 300, y: 300 }, zones)).toBe(0)
  })

  it('keeps a canopy on the hall pad it was already on', () => {
    expect(standingHeightAt(canopy, centre(hallPad), zones)).toBe(hallPad.elevation)
  })

  it('keeps a canopy dropped upstairs on the deck pad', () => {
    expect(standingHeightAt(canopy, centre(deckPad), zones)).toBe(deckPad.elevation)
  })

  /**
   * The sharpest statement of "zoneKind wins": at ONE point, a chair reads the
   * deck and a bar unit reads its own home zone. A fixed station never stands
   * where it was dropped — clampToVenue snaps it back into the bar rectangle —
   * so the ground under the drop point is not the surface it ends up on.
   */
  it('answers a fixed station from its home zone, not from the point', () => {
    const onTheDeck = centre(deck)
    expect(barZone.elevation).toBeUndefined()
    expect(standingHeightAt(barUnit, onTheDeck, zones)).toBe(0)
    expect(standingHeightAt(booth, onTheDeck, zones)).toBe(0)
    expect(standingHeightAt(chair, onTheDeck, zones)).toBe(deck.elevation)
  })

  /** The truss is bolted to the hall and does not rise over the deck. */
  it('does not lift a hung fixture that happens to be over the deck', () => {
    expect(standingHeightAt(pendant, centre(deck), zones)).toBe(0)
  })
})
