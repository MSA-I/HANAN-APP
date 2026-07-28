/**
 * PLAN-06 seen from the state layer: what actions.ts DOES with the answer
 * collision.ts gives. collision.test.ts owns the geometry; these are the four
 * decisions that live in the mutation path and nowhere else.
 *
 *  - A table-top child is JUDGED. `ruled()` used to return false for anything
 *    with a parent, which switched every gate off for the whole table top — the
 *    reason two centrepieces could end up in the same square centimetre.
 *  - Enforcement is still NOT retroactive, and that now reaches children: one
 *    already standing in its neighbour may be dragged, turned and resized,
 *    including apart. Refusing is the one answer that could never fix it.
 *  - The reception deck's whitelist is a single list (`allowedOnDeck`). The judge
 *    and the clamp used to keep one each, and they drifted (§27).
 *  - A zone an entry may stand ONLY in must not be the zone that ejects it.
 *
 * Every distance is derived from the catalog. The place setting has already been
 * rescaled once and the ⌀180 has moved once, so a copied number here would keep
 * the file green while it stopped testing anything.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { getVenuePack } from '../core/venuePacks'
import type { Vec2 } from '../core/model/types'
import { composeTransform } from '../core/space'
import { allowedOnDeck, checkPlacement, type Violation } from '../core/layout/collision'
import {
  addObject,
  addObjectToSurface,
  duplicateObjects,
  moveObjectsBy,
  newProject,
  setPosition,
  setRotation,
  setSize,
} from './actions'
import { objectAABB } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const kinds = (violations: Violation[]) => violations.map((v) => v.kind)

const TABLE = 'table.round'
/** centre-anchored: §28 puts it in the middle of the table whatever the pointer said */
const DECOR = 'decor.candelabra-crystal'
/** free-anchored, so it is judged exactly where it is put */
const SETTING = 'decor.place-setting'

const outlineR = (catalogId: string): number => {
  const entry = getCatalogEntry(catalogId)
  const outline = entry.footprint(entry.defaultSize).outline
  if (outline.kind !== 'circle') throw new Error(`${catalogId} is not round`)
  return outline.r
}

/** Centre distance at which a square-on setting touches a centrepiece in the middle. */
const REACH = outlineR(DECOR) + getCatalogEntry(SETTING).defaultSize.width / 2
const CLEAR = REACH + 10
const HIT = REACH - 10

/** The ghost of a NEW drop: world point plus the table under it (Stage2D.tsx:316). */
const ghostOnTable = (catalogId: string, tableId: string, local: Vec2) => {
  const world = composeTransform(scene().objects[tableId].transform, {
    position: local,
    rotation: 0,
    elevation: 0,
  })
  return {
    catalogId,
    transform: { position: world.position, rotation: world.rotation, elevation: 0 },
    size: getCatalogEntry(catalogId).defaultSize,
    parentId: tableId,
  }
}

/**
 * An EXISTING child probed at a parent-local pose — the frame `candidateFor`
 * hands over. `excludeId` is not optional in practice: a child left in the
 * obstacle set collides with itself.
 */
const probe = (
  catalogId: string,
  tableId: string,
  local: Vec2,
  opts: { excludeId?: string; rotation?: number } = {},
) => ({
  catalogId,
  transform: { position: local, rotation: opts.rotation ?? 0, elevation: 0 },
  size: getCatalogEntry(catalogId).defaultSize,
  parentId: tableId,
  parentLocal: true,
  excludeId: opts.excludeId,
})

/** A table-top child at an exact parent-local spot, placed the way a drop places it. */
const childAt = (catalogId: string, tableId: string, local: Vec2): string => {
  const world = composeTransform(scene().objects[tableId].transform, {
    position: local,
    rotation: 0,
    elevation: 0,
  })
  const id = addObjectToSurface(catalogId, tableId, world.position)
  if (!id) throw new Error(`could not attach ${catalogId}`)
  return id
}

beforeEach(() => {
  newProject({ name: 'table tops', venueWidth: 4000, venueDepth: 3000 })
})

describe('a second centrepiece on an occupied table', () => {
  it('is refused, and names the piece already standing in the middle', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    // placed by the real drop path, so §28 is what put it in the middle
    const first = childAt(DECOR, table, { x: CLEAR, y: 0 })
    expect(scene().objects[first].transform.position).toEqual({ x: 0, y: 0 })

    // The question the click asks before anything is created (Stage2D.tsx:316):
    // a red ghost does not click, which is what refuses the drop —
    // `addObjectToSurface` itself does not gate.
    const v = checkPlacement(scene(), ghostOnTable(DECOR, table, { x: CLEAR, y: 0 }))
    expect(kinds(v)).toEqual(['overlapsSibling'])
    expect(v[0]).toMatchObject({ id: first })
  })
})

describe('dragging a table-top item into its neighbour', () => {
  it('stops it at the contact point instead of letting it through', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    const middle = childAt(DECOR, table, { x: 0, y: 0 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    // the gate applies to it at all only because it is legal where it stands
    expect(
      checkPlacement(scene(), probe(SETTING, table, { x: CLEAR, y: 0 }, { excludeId: setting })),
    ).toEqual([])

    setPosition(setting, { x: 0, y: 0 }) // aimed straight at the centrepiece

    const at = scene().objects[setting].transform.position
    expect(at.x).toBeLessThan(CLEAR) // it did travel
    expect(at.x).toBeGreaterThan(REACH - 0.5) // and stopped where the two touch
    expect(
      checkPlacement(scene(), probe(SETTING, table, at, { excludeId: setting })),
    ).toEqual([])
    // the piece it ran into did not move out of the way
    expect(scene().objects[middle].transform.position).toEqual({ x: 0, y: 0 })
  })

  it('refuses a resize that would grow one item into another', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    childAt(DECOR, table, { x: 0, y: 0 })
    const setting = childAt(SETTING, table, { x: CLEAR, y: 0 })
    const was = scene().objects[setting].size.width

    setSize(setting, { width: was + 4 * REACH }) // wide enough to swallow the middle
    expect(scene().objects[setting].size.width).toBe(was)
  })

  it('refuses a rotation that swings one item into another', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    childAt(DECOR, table, { x: 0, y: 0 })
    const at = { x: REACH + 2, y: 0 }
    const setting = childAt(SETTING, table, at)

    // the claim the refusal rests on: square-on it clears, on the diagonal the
    // same spot does not, because the corner reaches further than the edge
    expect(checkPlacement(scene(), probe(SETTING, table, at, { excludeId: setting }))).toEqual([])
    expect(
      kinds(checkPlacement(scene(), probe(SETTING, table, at, { excludeId: setting, rotation: 45 }))),
    ).toEqual(['overlapsSibling'])

    setRotation(setting, 45)
    expect(scene().objects[setting].transform.rotation).toBe(0)
  })
})

/**
 * The retroactive exemption, stated as a POSITIVE right rather than as an absence.
 * `addObjectToSurface` does not gate and an old design lays what it likes, so
 * overlapping children exist; gating them would freeze them in place forever,
 * since every candidate pose inherits the violation they already have.
 */
describe('a child already standing inside its neighbour', () => {
  const overlapping = () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    childAt(DECOR, table, { x: 0, y: 0 })
    const setting = childAt(SETTING, table, { x: 0, y: 0 })
    expect(
      kinds(checkPlacement(scene(), probe(SETTING, table, { x: 0, y: 0 }, { excludeId: setting }))),
    ).toEqual(['overlapsSibling'])
    return { table, setting }
  }

  it('may still be dragged — deeper in, and then apart', () => {
    const { setting } = overlapping()
    setPosition(setting, { x: HIT, y: 0 }) // still overlapping, still allowed
    expect(scene().objects[setting].transform.position.x).toBe(HIT)
    setPosition(setting, { x: CLEAR, y: 0 })
    expect(scene().objects[setting].transform.position.x).toBe(CLEAR)
  })

  it('may still be turned', () => {
    const { setting } = overlapping()
    setRotation(setting, 30)
    expect(scene().objects[setting].transform.rotation).toBe(30)
  })

  it('may still be resized', () => {
    const { setting } = overlapping()
    const was = scene().objects[setting].size.width
    setSize(setting, { width: was + 20 })
    expect(scene().objects[setting].size.width).toBe(was + 20)
  })
})

describe('the reception deck answers the same question twice (§27)', () => {
  const pack = getVenuePack('resort')!
  const DECK = pack.restricted!.find((z) => z.kind === 'kabalatPanim')!
  const deckCentre = { x: DECK.x + DECK.width / 2, y: DECK.y + DECK.depth / 2 }

  const overlapsDeck = (id: string) => {
    const b = objectAABB(scene(), id)!
    return (
      b.minX < DECK.x + DECK.width && b.maxX > DECK.x && b.minY < DECK.y + DECK.depth && b.maxY > DECK.y
    )
  }

  const fresh = () =>
    newProject({
      name: 'deck',
      venueWidth: pack.size.width,
      venueDepth: pack.size.depth,
      venuePackId: 'resort',
    })

  it('keeps a guest table up there, fully inside the deck', () => {
    fresh()
    const id = addObject(TABLE, deckCentre)
    const b = objectAABB(scene(), id)!
    expect(b.minX).toBeGreaterThanOrEqual(DECK.x - 0.01)
    expect(b.maxX).toBeLessThanOrEqual(DECK.x + DECK.width + 0.01)
    expect(b.minY).toBeGreaterThanOrEqual(DECK.y - 0.01)
    expect(b.maxY).toBeLessThanOrEqual(DECK.y + DECK.depth + 0.01)
  })

  /**
   * The unification itself: the clamp keeps EXACTLY what the judge admits. Driven
   * off `allowedOnDeck` rather than a list repeated here, because a second list is
   * the bug this test exists to prevent.
   */
  it('keeps what `allowedOnDeck` names and pushes out everything else', () => {
    for (const catalogId of [TABLE, 'buffet.table', 'chair.x-white', 'divider.screen', 'plant.potted-2']) {
      fresh()
      const id = addObject(catalogId, deckCentre)
      expect([catalogId, overlapsDeck(id)]).toEqual([
        catalogId,
        allowedOnDeck(getCatalogEntry(catalogId)),
      ])
    }
  })
})

describe('a zone an entry may stand ONLY in', () => {
  const pack = getVenuePack('resort')!
  const SAVIV = pack.restricted!.find((z) => z.kind === 'saviv')!
  const POOL = pack.restricted!.find((z) => z.kind === 'pool')!
  const PLANT = 'plant.potted'

  beforeEach(() => {
    newProject({
      name: 'saviv',
      venueWidth: pack.size.width,
      venueDepth: pack.size.depth,
      venuePackId: 'resort',
    })
  })

  it('does not eject the entry that named it', () => {
    expect(getCatalogEntry(PLANT).allowedZones?.map((r) => r.kind)).toEqual(['saviv'])
    // the strip of the surround that is clear of the water — the two rectangles
    // overlap everywhere left of the pool's right edge (venuePacks.ts:139-144)
    const drop = {
      x: (POOL.x + POOL.width + SAVIV.x + SAVIV.width) / 2,
      y: SAVIV.y + SAVIV.depth / 2,
    }
    const id = addObject(PLANT, drop)

    const p = scene().objects[id].transform.position
    expect(p.x).toBeGreaterThanOrEqual(SAVIV.x)
    expect(p.x).toBeLessThanOrEqual(SAVIV.x + SAVIV.width)
    expect(p.y).toBeGreaterThanOrEqual(SAVIV.y)
    expect(p.y).toBeLessThanOrEqual(SAVIV.y + SAVIV.depth)
  })

  it('and every OTHER zone still pushes it out — the water included', () => {
    const drop = {
      x: (POOL.x + POOL.width + SAVIV.x + SAVIV.width) / 2,
      y: SAVIV.y + SAVIV.depth / 2,
    }
    const id = addObject(PLANT, drop)
    expect(objectAABB(scene(), id)!.minX).toBeGreaterThanOrEqual(POOL.x + POOL.width - 0.01)
  })
})

/**
 * An object with a NaN position can never be selected, drawn or repaired, so the
 * clamp asks whether its box is finite before it computes any shift from it.
 *
 * Measured, so that the next reader does not over-credit the guard: as the code
 * stands these two pass WITHOUT it. Every write in `clampToVenue` happens to sit
 * behind a comparison, and a comparison against NaN is false — so today a broken
 * box yields no shift rather than a NaN one. The guard makes that explicit instead
 * of accidental, and these are the regression tests for the day someone turns one
 * of those `else if` chains into arithmetic. They are a lock, not a bug report.
 */
describe('a broken size never becomes a broken position', () => {
  const poison = (id: string) => {
    useEditorStore.setState((s) => {
      s.scene.objects[id].size.width = NaN
    })
  }
  const finite = (id: string) => {
    const p = scene().objects[id].transform.position
    return Number.isFinite(p.x) && Number.isFinite(p.y)
  }

  it('survives the legacy clamp, which is the one that pushes', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    poison(table)
    const [copy] = duplicateObjects([table])
    expect(finite(copy)).toBe(true)
    expect(finite(table)).toBe(true)
  })

  it('survives a move', () => {
    const table = addObject(TABLE, { x: 1000, y: 1000 })
    poison(table)
    moveObjectsBy([table], { x: 50, y: 0 })
    expect(finite(table)).toBe(true)
  })
})
