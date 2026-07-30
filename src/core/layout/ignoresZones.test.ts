/**
 * `ignoresZones` — round 4 §7, the chuppah decorations: "placeable anywhere in
 * the hall, in any zone".
 *
 * The flag is narrow on purpose, and the whole risk in it is that it quietly
 * becomes one of the two flags it sits between. So every case here states BOTH
 * halves: what the entry is now let through, and what still refuses it.
 *
 *   let through   the zone loop, and only the zone loop — pool, dance floor,
 *                 ceremony pad, aisle, reception deck
 *   still refused overlap with furniture, the venue outline, and — because the
 *                 home rectangle is gone — the teleport that used to drag the
 *                 piece into the aisle from wherever it was dropped
 *
 * Driven through the real actions rather than through `checkPlacement` alone,
 * modelled on kabalatPanim.test.ts: the fault being fixed lived half in
 * collision.ts and half in `clampToVenue`, and a test that only asked the first
 * would have passed all along.
 *
 * Every rectangle is read off the live pack (BRIEF §1.7) — the aisle strip moved
 * once already, on 2026-07-29.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { listCatalog } from '../catalog/registry'
import type { SceneState, Vec2 } from '../model/types'
import { getVenuePack } from '../venuePacks'
import { addObject, newProject } from '../../state/actions'
import { objectAABB } from '../../state/selectors'
import { useEditorStore } from '../../state/store'
import { checkPlacement, type Violation } from './collision'
import { standingHeightAt } from './groundHeight'
import { isZoneInside } from './zoneOccupancy'

const scene = (): SceneState => useEditorStore.getState().scene
const pack = getVenuePack('resort')!
const zones = pack.restricted!

const zone = (kind: string) => zones.find((z) => z.kind === kind)!
const centre = (z: { x: number; y: number; width: number; depth: number }) => ({
  x: z.x + z.width / 2,
  y: z.y + z.depth / 2,
})

const DECK = zone('kabalatPanim')
const POOL = zone('pool')
const DANCEFLOOR = zone('dancefloor')
const AISLE = zone('shvilHupa')
const HALL_PAD = zones.find((z) => z.kind === 'chuppah' && !isZoneInside(z, DECK))!

/** The entry under test, found by the flag rather than by its id. */
const DECOR = listCatalog().find((e) => e.ignoresZones)!

/** A bare candidate at a pose — no scene object behind it, like a library ghost. */
const ghost = (catalogId: string, position: Vec2, rotation = 0) => ({
  catalogId,
  transform: { position, rotation, elevation: 0 },
  size: listCatalog().find((e) => e.id === catalogId)!.defaultSize,
})

const kinds = (violations: Violation[]) => violations.map((v) => v.kind)

/** A far corner of the hall floor, clear of every zone and of the baked fixtures. */
const FAR_CORNER = { x: 300, y: 300 }

beforeEach(() => {
  newProject({
    name: 'ignoresZones',
    venueWidth: pack.size.width,
    venueDepth: pack.size.depth,
    venuePackId: 'resort',
  })
})

describe('what the entry declares', () => {
  it('carries the narrow flag and NO home rectangle', () => {
    expect(DECOR.ignoresZones).toBe(true)
    // the two flags it is not: `zoneKind` would teleport it into one rectangle,
    // `placeAnywhere` would lift every rule including the venue outline
    expect(DECOR.zoneKind).toBeUndefined()
    expect(DECOR.placeAnywhere).toBeUndefined()
    // it is still a thing that stands on the ground, not table decor
    expect(DECOR.placement ?? 'floor').toBe('floor')
  })

  /**
   * The aisle rectangle did NOT go away — only the entry's claim on it did. Said
   * here so that a future reading of "the decorations no longer use shvilHupa"
   * does not turn into "shvilHupa is dead, delete it": the zone is still drawn,
   * still labelled and still the ground the walk is measured on.
   */
  it('leaves the aisle rectangle in the pack', () => {
    expect(AISLE.width).toBeGreaterThan(0)
    expect(AISLE.depth).toBeGreaterThan(0)
    expect(zones.filter((z) => z.kind === 'shvilHupa')).toHaveLength(1)
  })
})

describe('the zones it may now stand in', () => {
  it('stands in the pool', () => {
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, centre(POOL))))).toEqual([])
  })

  it('stands on the ceremony pad', () => {
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, centre(HALL_PAD))))).toEqual([])
  })

  it('stands on the dance floor', () => {
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, centre(DANCEFLOOR))))).toEqual([])
  })

  /**
   * The half that lives in `clampToVenue`. A green ghost over the pool and an
   * object shoved out of it a moment later is the fault source doc §57 is about,
   * so the drop is checked as well as the check.
   */
  it('is still in the pool after the drop, not pushed out of it', () => {
    const id = addObject(DECOR.id, centre(POOL))
    const box = objectAABB(scene(), id)!
    expect(box.minX).toBeGreaterThan(POOL.x)
    expect(box.maxX).toBeLessThan(POOL.x + POOL.width)
    expect(box.minY).toBeGreaterThan(POOL.y)
    expect(box.maxY).toBeLessThan(POOL.y + POOL.depth)
  })

  it('stays on the reception deck', () => {
    const id = addObject(DECOR.id, centre(DECK))
    const box = objectAABB(scene(), id)!
    expect(box.minX).toBeGreaterThanOrEqual(DECK.x - 0.01)
    expect(box.maxX).toBeLessThanOrEqual(DECK.x + DECK.width + 0.01)
    expect(box.minY).toBeGreaterThanOrEqual(DECK.y - 0.01)
    expect(box.maxY).toBeLessThanOrEqual(DECK.y + DECK.depth + 0.01)
  })
})

describe('the leash that is gone', () => {
  /**
   * THE regression. `zoneKind` is not a permission, it is a home: `clampToVenue`
   * snapped the decoration into the 140 × 600 cm aisle strip from anywhere in the
   * 60 m hall, so "put one by the door" put it by the chuppah.
   */
  it('is not teleported into the aisle from across the hall', () => {
    const id = addObject(DECOR.id, FAR_CORNER)
    const at = scene().objects[id].transform.position
    expect(at.x).toBeCloseTo(FAR_CORNER.x, 6)
    expect(at.y).toBeCloseTo(FAR_CORNER.y, 6)
    // and it really is nowhere near the strip it used to be dragged into
    expect(Math.hypot(at.x - centre(AISLE).x, at.y - centre(AISLE).y)).toBeGreaterThan(1000)
  })

  /**
   * Height follows from the same change. With no `zoneKind`, `standingHeightAt`
   * falls through to the geometric answer — the level of the ground the piece is
   * actually on — exactly as a chair does.
   *
   * Nothing already saved moves: the aisle overlaps only `dancefloor` and `pool`,
   * and neither declares an `elevation`, so every point inside it still answers 0.
   */
  it('reads its level off the ground it stands on', () => {
    expect(standingHeightAt(DECOR, FAR_CORNER, zones)).toBe(0)
    expect(standingHeightAt(DECOR, centre(AISLE), zones)).toBe(0)
    expect(standingHeightAt(DECOR, centre(HALL_PAD), zones)).toBe(HALL_PAD.elevation)
    expect(standingHeightAt(DECOR, centre(DECK), zones)).toBe(DECK.elevation)
    // the number the deck actually declares, so the line above cannot pass vacuously
    expect(DECK.elevation).toBe(470)
  })

  /**
   * "Nothing already saved moves" is the claim the change rests on, and it is a
   * claim about the aisle in particular: every decoration in every saved project
   * was clamped INTO that strip, so those are the only points that matter.
   *
   * ⚠ MEASURED, and it is not simply "the strip reads 0". The strip's south edge
   * IS the ceremony pad's north edge — the pack says so in as many words, "met
   * exactly, so the walk and the pad are continuous" — and `isPointInZone`
   * includes its boundary, so a point ON that line reads the pad's +50. That is
   * unreachable for a saved object all the same: `zoneShift` held the whole BOX
   * inside the strip, so a decoration's centre could never be nearer the edge than
   * half its own depth. The band below is the reachable one, and it is flat.
   */
  it('leaves every reachable point of the old aisle at ground level', () => {
    const reach = DECOR.defaultSize.depth / 2
    const halfW = DECOR.defaultSize.width / 2
    expect(AISLE.depth).toBeGreaterThan(DECOR.defaultSize.depth)
    expect(AISLE.width).toBeGreaterThan(DECOR.defaultSize.width)
    for (const p of [
      { x: AISLE.x + halfW, y: AISLE.y + reach },
      centre(AISLE),
      { x: AISLE.x + AISLE.width - halfW, y: AISLE.y + AISLE.depth - reach },
    ]) {
      expect(standingHeightAt(DECOR, p, zones)).toBe(0)
    }
    // the shared edge itself, so the exception above is stated rather than implied
    expect(standingHeightAt(DECOR, { x: centre(AISLE).x, y: AISLE.y + AISLE.depth }, zones)).toBe(
      HALL_PAD.elevation,
    )
  })
})

describe('the rules it still answers to', () => {
  it('collides with a table dropped on top of it', () => {
    addObject(DECOR.id, FAR_CORNER)
    expect(kinds(checkPlacement(scene(), ghost('table.round', FAR_CORNER)))).toContain('collision')
  })

  it('is refused where a table already stands', () => {
    addObject('table.round', FAR_CORNER)
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, FAR_CORNER)))).toContain('collision')
  })

  /** Two of them in the pool: the zone is open, the piece of floor is not. */
  it('collides with another decoration inside a zone the loop no longer guards', () => {
    addObject(DECOR.id, centre(POOL))
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, centre(POOL))))).toContain('collision')
  })

  it('is refused outside the venue', () => {
    expect(kinds(checkPlacement(scene(), ghost(DECOR.id, { x: -100, y: 500 })))).toEqual([
      'outOfBounds',
    ])
    expect(
      kinds(checkPlacement(scene(), ghost(DECOR.id, { x: 500, y: pack.size.depth + 100 }))),
    ).toEqual(['outOfBounds'])
  })
})
