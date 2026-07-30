/**
 * Ceiling placement is the only thing in the app that seeds a non-zero
 * elevation at creation time, and it depends on the venue — so it is worth
 * pinning down: the item's TOP meets the ceiling, and it stays a top-level
 * object rather than becoming an attached child like table decor.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry, listCatalog } from '../catalog/registry'
import { strings } from '../../ui/strings'
import { clampHang, hangRange, MAX_DROP_FROM_CEILING } from '../layout/beams'
import { getVenuePack } from '../venuePacks'
import { createObject, DEFAULT_WALL_HEIGHT } from './factory'

const at = { x: 100, y: 100 }

/** The seeded drop is the entry's own height, so never spell it out twice. */
const dropOf = (id: string) => getCatalogEntry(id).defaultSize.height

describe('ceiling placement', () => {
  it('hangs the item so its top meets the ceiling of a pack hall', () => {
    const entry = getCatalogEntry('lamp.pendant')
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160 })
    expect(obj.transform.elevation).toBe(1160 - entry.defaultSize.height)
    expect(obj.transform.elevation + obj.size.height).toBe(1160)
  })

  // ⚠ At wallHeight 350 this now asserts a NEGATIVE elevation — the cluster's drop
  // is 375 since round-4 item 14a. That is the honest reading of the arithmetic and
  // is left alone; the consequence is stated outright in `catalogued scale` below.
  it('scales the drop to whatever ceiling it is given', () => {
    const drop = dropOf('lamp.pendant-cluster')
    expect(createObject('lamp.pendant-cluster', at, { wallHeight: 350 }).transform.elevation).toBe(350 - drop)
    expect(createObject('lamp.pendant-cluster', at, { wallHeight: 1160 }).transform.elevation).toBe(1160 - drop)
  })

  it('assumes a procedural room when no venue is passed', () => {
    const obj = createObject('lamp.pendant', at)
    expect(obj.transform.elevation).toBe(DEFAULT_WALL_HEIGHT - dropOf('lamp.pendant'))
  })

  // The resort's roof apex is 1160 but its lighting truss sits at 895 — hung
  // items pin their top to the truss (hangHeight), not the ceiling. 895 stays a
  // literal here: it is the measured truss height and the whole point of the
  // test, unlike the drop, which is a catalogued size that has already moved.
  it('hangs from the pack hangHeight, not wallHeight, when the pack defines one', () => {
    const obj = createObject('lamp.chandelier-diamond', at, { wallHeight: 1160, venuePackId: 'resort' })
    expect(obj.transform.elevation).toBe(895 - dropOf('lamp.chandelier-diamond'))
    expect(obj.transform.elevation + obj.size.height).toBe(895)
  })

  it('falls back to wallHeight for an unknown pack id', () => {
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160, venuePackId: 'no-such-pack' })
    expect(obj.transform.elevation).toBe(1160 - dropOf('lamp.pendant'))
  })

  it('stays a top-level object, not an attached child', () => {
    const obj = createObject('lamp.pendant', at, { wallHeight: 1160 })
    expect(obj.parentId).toBeNull()
    expect(obj.attachment).toBeUndefined()
  })

  /**
   * A chandelier is the tallest thing that hangs, and the ×2.5 of corrections
   * document §8 made the candelabra 300 cm — six sevenths of the 350 cm
   * procedural room. It still seeds ABOVE the floor rather than going negative,
   * which is the regression this guards and which is what the whole app relies
   * on. It no longer clears head height, though: the assertion used to be
   * `> 200` and the honest number is now 50 cm of air under a 3 m fixture.
   *
   * That is the price of §8 and it is only paid in a PROCEDURAL room. The real
   * hall is 1160 with its truss at 895, where all five fixtures keep the full
   * 135 cm slider (handoff/03-sizes.md §A.2). Weakening this to `> 0` would hide
   * the fact; stating 350 − height names it instead.
   */
  it('keeps the tallest chandelier above the floor in a low room', () => {
    const drop = dropOf('lamp.chandelier-candelabra')
    const obj = createObject('lamp.chandelier-candelabra', at, { wallHeight: 350 })
    expect(obj.transform.elevation).toBe(350 - drop)
    expect(obj.transform.elevation).toBeGreaterThan(0)
    // and the fixture really does fill the room now — this is not a rounding
    expect(drop / 350).toBeGreaterThan(0.8)
  })
})

describe('chandelier entries', () => {
  const ids = ['lamp.chandelier-diamond', 'lamp.chandelier-basket', 'lamp.chandelier-candelabra']

  it.each(ids)('%s hangs from the ceiling', (id) => {
    expect(getCatalogEntry(id).placement).toBe('ceiling')
  })

  // The GLBs still model a 90–120 cm drop; corrections document §8 catalogues the
  // three CHANDELIERS at 2.5× that, so the drop the app uses is 225–300. (The two
  // pendants went to ×6.25 in round-4 item 14a and are not in this sweep — the
  // per-family scales are pinned in `catalogued scale` below.)
  // Both ends are asserted because the PAIR is what the 3D fit divides by
  // (`size / (modelSize ?? defaultSize)`, propModel.ts:56-66): an entry that
  // grew its defaultSize without declaring the file's own modelSize would draw
  // large in 2D and render small in 3D, silently.
  it.each(ids)('%s drops between 225 and 300 cm, from a file that models 90 to 120', (id) => {
    const { defaultSize, modelSize } = getCatalogEntry(id)
    expect(defaultSize.height).toBeGreaterThanOrEqual(225)
    expect(defaultSize.height).toBeLessThanOrEqual(300)
    if (!modelSize) throw new Error(`${id}: a rescaled entry must state its file's own size`)
    expect(modelSize.height).toBeGreaterThanOrEqual(90)
    expect(modelSize.height).toBeLessThanOrEqual(120)
  })

  // guards the real-inventory principle: 7 source GLBs collapsed to 3 products
  it('has exactly three chandeliers', () => {
    expect(listCatalog().filter((e) => e.id.startsWith('lamp.chandelier-'))).toHaveLength(3)
  })
})

/**
 * The ×2.5 of corrections document §8 was flagged as the change most likely to
 * break hanging, on the theory that a tall enough fixture would push `min` past
 * `max` and collapse the slider. It cannot: both ends of the band are anchored
 * MINUS the height, so they move together and the width
 * `MAX_DROP_FROM_CEILING − (wallHeight − hangHeight)` does not depend on the
 * fixture at all. The band can only collapse once `max(0, …)` bites, which in
 * the resort needs a 895 cm fixture. This pins that for every fixture the
 * catalog actually ships, so the next rescale cannot quietly break it.
 */
describe('every ceiling fixture still has a band to hang in', () => {
  const pack = getVenuePack('resort')!
  const fixtures = listCatalog().filter((e) => e.placement === 'ceiling')

  it('covers all five, so the sweep below is not vacuous', () => {
    expect(fixtures).toHaveLength(5)
  })

  it.each(fixtures.map((e) => e.id))('%s keeps the full slider', (id) => {
    const height = getCatalogEntry(id).defaultSize.height
    const { min, max } = hangRange(pack, pack.wallHeight, height)
    expect(max).toBeGreaterThan(min)
    // the width is the venue's, not the fixture's
    expect(max - min).toBe(MAX_DROP_FROM_CEILING - (pack.wallHeight - pack.hangHeight!))
  })

  it.each(fixtures.map((e) => e.id))('%s is seeded at the top of its own band', (id) => {
    const height = getCatalogEntry(id).defaultSize.height
    const obj = createObject(id, at, { wallHeight: pack.wallHeight, venuePackId: pack.id, size: pack.size })
    // createObject seeds without clamping, so the two must already agree
    expect(obj.transform.elevation).toBe(hangRange(pack, pack.wallHeight, height).max)
    expect(clampHang(pack, pack.wallHeight, height, obj.transform.elevation)).toBe(obj.transform.elevation)
  })
})

/**
 * The scale each family is catalogued at, and what it costs.
 *
 * There was NO coverage of this before round 4: five suspected tests were checked
 * and not one of them would have failed if a fixture's scale had been changed by
 * hand — the chandelier sweep runs on the three chandeliers, the band test only
 * cares that the width is the venue's, and `dropOf` reads whatever the catalogue
 * says. That absence is why these exist.
 */
describe('catalogued scale', () => {
  const pack = getVenuePack('resort')!
  const PENDANT_SCALE = 6.25
  const CHANDELIER_SCALE = 2.5
  const families: [string, number][] = [
    ['lamp.pendant', PENDANT_SCALE],
    ['lamp.pendant-cluster', PENDANT_SCALE],
    ['lamp.chandelier-diamond', CHANDELIER_SCALE],
    ['lamp.chandelier-basket', CHANDELIER_SCALE],
    ['lamp.chandelier-candelabra', CHANDELIER_SCALE],
  ]

  it('covers every ceiling fixture, so a sixth one cannot slip past unscaled', () => {
    expect(families.map(([id]) => id).sort()).toEqual(
      listCatalog().filter((e) => e.placement === 'ceiling').map((e) => e.id).sort(),
    )
  })

  /**
   * ⚠ `toBeCloseTo`, not `toBe`, and only because of ONE product: 18.1 × 6.25 comes
   * out 113.12500000000001, since 25/4 is exact but 18.1 is not a double. The error
   * is 1.4e-14 cm. The alternative was writing the two `defaultSize`s out as
   * literals, which would have broken the property this file relies on — that the
   * ratio the 3D loader fits by (`size / modelSize`) is the same number the plan
   * draws with.
   */
  it.each(families)('%s is its file bounds × %d on all three axes', (id, scale) => {
    const { defaultSize, modelSize } = getCatalogEntry(id)
    if (!modelSize) throw new Error(`${id}: a rescaled entry must state its file's own size`)
    for (const axis of ['width', 'depth', 'height'] as const) {
      expect(defaultSize[axis] / modelSize[axis]).toBeCloseTo(scale, 9)
    }
  })

  /**
   * `hangRange`'s band is `[max(0, wallHeight − MAX_DROP_FROM_CEILING − height),
   * hangHeight − height]`. The `max(0, …)` is the cliff: past it the bottom of the
   * band stops moving with the fixture and the slider starts to shrink. In the
   * resort that is height 510, and the tallest fixture is now 375 — so the margin
   * is 135 cm, where before ×6.25 the tallest was 300 and it was 210.
   */
  it('leaves every fixture short of the height where its slider starts to shrink', () => {
    const cliff = pack.wallHeight - MAX_DROP_FROM_CEILING
    for (const [id] of families) {
      expect(getCatalogEntry(id).defaultSize.height, id).toBeLessThan(cliff)
    }
    // and the tallest really is close enough for this to be worth asserting
    const tallest = Math.max(...families.map(([id]) => getCatalogEntry(id).defaultSize.height))
    expect(cliff - tallest).toBeLessThan(MAX_DROP_FROM_CEILING)
  })

  /**
   * The price of ×6.25, stated so it cannot be discovered by accident: the cluster
   * is now TALLER than a default procedural room, and `createObject` seeds
   * `wallHeight − height` with no clamp (factory.ts:155-157), so it seeds below the
   * floor there. Nothing ships broken — the only pack is the resort at 1160/895 —
   * but a procedural room is what every project gets before a venue is chosen.
   */
  it('no longer fits the 350 cm procedural room, and says so instead of hiding it', () => {
    const drop = dropOf('lamp.pendant-cluster')
    expect(drop).toBeGreaterThan(DEFAULT_WALL_HEIGHT)
    expect(createObject('lamp.pendant-cluster', at, { wallHeight: DEFAULT_WALL_HEIGHT }).transform.elevation)
      .toBeLessThan(0)
    // the band has collapsed to a point at the floor, which is `hangRange` refusing
    // to invert rather than a legal place to hang
    expect(hangRange(undefined, DEFAULT_WALL_HEIGHT, drop)).toEqual({ min: 0, max: 0 })
    // the pendant still fits, so this is about the cluster and not about ×6.25
    expect(hangRange(undefined, DEFAULT_WALL_HEIGHT, dropOf('lamp.pendant')).max).toBeGreaterThan(0)
    // and in the real hall both are fine — which is why nothing ships broken
    for (const id of ['lamp.pendant', 'lamp.pendant-cluster']) {
      expect(hangRange(pack, pack.wallHeight, dropOf(id)).max, id).toBeGreaterThan(0)
    }
  })
})

describe('every other placement still starts on the floor', () => {
  it.each(['plant.potted', 'plant.potted-2', 'lamp.arc-crystal', 'decor.vase-ceramic'])('%s', (id) => {
    expect(createObject(id, at, { wallHeight: 1160 }).transform.elevation).toBe(0)
  })
})

describe('vegetation catalog entries', () => {
  const ids = ['plant.potted', 'plant.potted-2']

  // The sizes below are the FILES' own prepped bounds — measured, external, and
  // the thing `modelSize` exists to record. Corrections document §6 catalogues
  // both plants at 1.5× them, and the GLBs were NOT re-prepped, so the entry
  // must carry both numbers or the 3D fit divides by the wrong one.
  it.each([
    ['plant.potted', 'plant', '/props/plant-vegetation-1.glb', '/thumbs/plant-potted.webp', 101, 94.6],
    ['plant.potted-2', 'plant2', '/props/plant-vegetation-2.glb', '/thumbs/plant-potted-2.webp', 47.5, 43.8],
  ])('%s matches its prepared model and thumbnail', (id, labelKey, model, thumbnail, width, depth) => {
    const entry = getCatalogEntry(id as string)
    expect(entry.labelKey).toBe(labelKey)
    expect(entry.model).toBe(model)
    expect(entry.thumbnail).toBe(thumbnail)
    expect(entry.modelSize).toEqual({ width, depth, height: 160 })
    expect(entry.defaultSize.width).toBeCloseTo((width as number) * 1.5)
    expect(entry.defaultSize.depth).toBeCloseTo((depth as number) * 1.5)
    expect(entry.defaultSize.height).toBe(240)
  })

  // ×1.5 pushes both plants towards a ceiling the entry sets on itself, and a
  // defaultSize outside its own maxSize would be a catalog that contradicts the
  // inspector's own slider on the first drag.
  it.each(ids)('%s stays inside its own maxSize', (id) => {
    const { defaultSize, maxSize, minSize } = getCatalogEntry(id)
    for (const axis of ['width', 'depth', 'height'] as const) {
      expect(defaultSize[axis]).toBeLessThanOrEqual(maxSize[axis] ?? Infinity)
      expect(defaultSize[axis]).toBeGreaterThanOrEqual(minSize[axis] ?? 0)
    }
  })

  it('uses the approved Hebrew labels', () => {
    expect(strings.catalog.items.plant).toBe('צמחייה 1')
    expect(strings.catalog.items.plant2).toBe('צמחייה 2')
  })
})
