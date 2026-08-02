/**
 * The placement rules (PLAN-03). Three things here are easy to break silently:
 *
 *  - Rotation. The pre-existing `aabbIntersects` reads a 45°-turned table as
 *    overlapping long before it touches, so every overlap case below is stated
 *    at an angle as well as square-on.
 *  - The chairs. A table's footprint is the table PLUS its seats; the rule that
 *    keeps a drag inside the venue is the same rule that must not let the chairs
 *    through the wall, and only a subtree-aware candidate does both.
 *  - Retroactivity. A project saved before these rules existed has to stay
 *    editable, which means "already illegal" has to switch enforcement OFF for
 *    that object rather than pinning it where it stands.
 *
 * Sizes and clearances are read from the catalog and from TABLE_CLEARANCE, never
 * copied — the ⌀180 and the 170cm aisle have both moved once already.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry, listCatalog } from '../catalog/registry'
import { getVenuePack } from '../venuePacks'
import type { SceneState, Vec2 } from '../model/types'
import { composeTransform } from '../space'
import { beamGrid, snapToBeam } from './beams'
import { holeRadius } from './bounds'
import { serpentineBandDepth, serpentineBandTiles } from './serpentine'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  mirrorObjects,
  moveObjectsBy,
  newProject,
  removeObjects,
  rotateObjectsBy,
  setChuppahLocation,
  setPosition,
  stackedPosition,
} from '../../state/actions'
import { useNoticeStore } from '../../state/notice'
import { objectAABB } from '../../state/selectors'
import { useEditorStore } from '../../state/store'
import { strings } from '../../ui/strings'
import { allowedOnDeck, checkPlacement, clearanceOf, slideToLegal, TABLE_CLEARANCE, type Violation } from './collision'

const scene = (): SceneState => useEditorStore.getState().scene
const pack = getVenuePack('resort')!
const POOL = pack.restricted!.find((z) => z.kind === 'pool')!

const ROUND_R = getCatalogEntry('table.round').defaultSize.width / 2
const SQUARE = getCatalogEntry('table.square').defaultSize

/** A bare candidate at a pose — no scene object behind it, like a library ghost. */
const ghost = (catalogId: string, position: Vec2, rotation = 0) => ({
  catalogId,
  transform: { position, rotation, elevation: 0 },
  size: getCatalogEntry(catalogId).defaultSize,
})

const kinds = (violations: Violation[]) => violations.map((v) => v.kind)

/** A table stripped of its chairs — the outline cases are about the table itself. */
const bareTable = (catalogId: string, position: Vec2): string => {
  const id = addObject(catalogId, position)
  removeObjects(Object.values(scene().objects).filter((o) => o.parentId === id).map((o) => o.id))
  return id
}

beforeEach(() => {
  newProject({ name: 'collision', venueWidth: 4000, venueDepth: 3000 })
})

// --- table-top helpers (PLAN-06) -------------------------------------------
// The three ways a table-top pose can be stated. Keeping them apart in the tests
// is the point: the frame a candidate arrives in is exactly what the sibling rule
// can get silently wrong.

/** The outer radius a round catalog item is drawn at — never a copied number. */
const outlineR = (catalogId: string): number => {
  const entry = getCatalogEntry(catalogId)
  const outline = entry.footprint(entry.defaultSize).outline
  if (outline.kind !== 'circle') throw new Error(`${catalogId} is not round`)
  return outline.r
}

/**
 * A ghost of a NEW table-top item: WORLD coordinates plus the table under it,
 * which is what editor2d/Stage2D.tsx and viewer3d/Placement3D.tsx hand over. The
 * local point is stated and `composeTransform` converts it, so the test says where
 * on the table it means and collision.ts has to undo the same transform.
 */
const surfaceGhost = (catalogId: string, tableId: string, local: Vec2, rotation = 0) => {
  const world = composeTransform(scene().objects[tableId].transform, {
    position: local,
    rotation,
    elevation: 0,
  })
  return { ...ghost(catalogId, world.position, world.rotation), parentId: tableId }
}

/** The same item as an EXISTING child being probed — parent-local, the frame a
 *  child's stored transform already lives in (state/actions.ts `candidateFor`). */
const localProbe = (catalogId: string, tableId: string, local: Vec2) => ({
  ...ghost(catalogId, local),
  parentId: tableId,
  parentLocal: true,
})

/**
 * A surface child at an EXACT parent-local pose and storey.
 *
 * `addObjectToSurface` builds it properly and the pose is overwritten afterwards,
 * because every `surfaceProp` entry is `surfaceAnchor: 'center'` (tableDecor.ts:57)
 * — it pins whatever it is given to the middle of the table, and most of these
 * cases are about two items NOT sharing the middle.
 */
const surfaceChild = (
  catalogId: string,
  tableId: string,
  local: Vec2,
  opts: { inHole?: boolean; rotation?: number } = {},
): string => {
  const id = addObjectToSurface(catalogId, tableId, scene().objects[tableId].transform.position)
  if (!id) throw new Error(`could not attach ${catalogId}`)
  useEditorStore.setState((s) => {
    const child = s.scene.objects[id]
    child.transform.position = { ...local }
    child.transform.rotation = opts.rotation ?? 0
    if (child.attachment?.kind === 'surface') child.attachment.inHole = opts.inHole || undefined
  })
  return id
}

describe('overlap (source doc §42 — elements may never intersect)', () => {
  it('catches two round tables sitting inside one another', () => {
    const a = addObject('table.round', { x: 1000, y: 1000 })
    const v = checkPlacement(scene(), ghost('table.round', { x: 1010, y: 1000 }))
    expect(kinds(v)).toContain('collision')
    expect(v.find((x) => x.kind === 'collision')).toMatchObject({ withId: a })
  })

  it('separates two rect tables whose bounding boxes DO intersect', () => {
    // offset diagonally by one full side and turned 45°: the turned square's AABB
    // straddles the other one, so aabbIntersects says yes and SAT says no
    bareTable('table.square', { x: 1000, y: 1000 })
    const offset = SQUARE.width
    const v = checkPlacement(scene(), ghost('table.square', { x: 1000 + offset, y: 1000 + offset }, 45))
    expect(kinds(v)).not.toContain('collision')
  })

  it('catches a rotated rect that a square-on test would miss', () => {
    bareTable('table.square', { x: 1000, y: 1000 })
    // 175cm apart: square-on they clear each other by 15cm, but 45° stretches the
    // 160 square into a 226-wide diamond that reaches straight through
    const clear = checkPlacement(scene(), ghost('table.square', { x: 1175, y: 1000 }))
    const hit = checkPlacement(scene(), ghost('table.square', { x: 1175, y: 1000 }, 45))
    expect(kinds(clear)).not.toContain('collision')
    expect(kinds(hit)).toContain('collision')
  })

  it('mixes circle and rect correctly', () => {
    bareTable('table.round', { x: 1000, y: 1000 })
    const touching = ROUND_R + SQUARE.width / 2 - 5
    const clear = ROUND_R + SQUARE.width / 2 + 5
    expect(kinds(checkPlacement(scene(), ghost('table.square', { x: 1000 + touching, y: 1000 })))).toContain('collision')
    expect(kinds(checkPlacement(scene(), ghost('table.square', { x: 1000 + clear, y: 1000 })))).not.toContain('collision')
  })

  it('counts a table WITH its chairs as one body', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const chairs = Object.values(scene().objects).filter((o) => o.parentId === table)
    expect(chairs.length).toBeGreaterThan(0)
    const reach = Math.max(
      ...chairs.map((c) => objectAABB(scene(), c.id)!.maxX),
    )
    // a spot clear of the TABLE but inside the chair ring is still occupied
    expect(reach).toBeGreaterThan(1000 + ROUND_R)
    const v = checkPlacement(scene(), ghost('divider.screen', { x: reach - 5, y: 1000 }))
    expect(kinds(v)).toContain('collision')
  })
})

describe('table-to-table clearance (source doc §37-38, measured edge to edge)', () => {
  it('holds a round pair to 120 and a rect pair to 170', () => {
    expect(TABLE_CLEARANCE.circle).toBe(120)
    expect(TABLE_CLEARANCE.rect).toBe(170)
    expect(TABLE_CLEARANCE.ring).toBe(TABLE_CLEARANCE.circle)
  })

  it('is measured between the outlines, so it is exact at the boundary', () => {
    addObject('table.round', { x: 1000, y: 1000 })
    const centres = 2 * ROUND_R + TABLE_CLEARANCE.circle
    const tooClose = checkPlacement(scene(), ghost('table.round', { x: 1000 + centres - 1, y: 1000 }))
    const justRight = checkPlacement(scene(), ghost('table.round', { x: 1000 + centres + 1, y: 1000 }))
    expect(kinds(tooClose)).toContain('spacing')
    expect(kinds(justRight)).toEqual([])
  })

  it('reports the measured gap and the required one', () => {
    addObject('table.round', { x: 1000, y: 1000 })
    const v = checkPlacement(scene(), ghost('table.round', { x: 1000 + 2 * ROUND_R + 60, y: 1000 }))
    const spacing = v.find((x) => x.kind === 'spacing')
    expect(spacing).toBeDefined()
    if (spacing?.kind !== 'spacing') throw new Error('unreachable')
    expect(spacing.actual).toBeCloseTo(60, 5)
    expect(spacing.required).toBe(120)
  })

  it('applies the STRICTER rule when the two tables differ', () => {
    addObject('table.square', { x: 1000, y: 1000 })
    // 130 of clear floor: fine between two round tables, short of the 170 a
    // rect table demands
    const at = 1000 + SQUARE.width / 2 + 130 + ROUND_R
    const v = checkPlacement(scene(), ghost('table.round', { x: at, y: 1000 }))
    const spacing = v.find((x) => x.kind === 'spacing')
    if (spacing?.kind !== 'spacing') throw new Error('expected a spacing violation')
    expect(spacing.required).toBe(170)
  })

  it('leaves chairs and decor out of it — only tables answer to the aisle rule', () => {
    addObject('table.round', { x: 1000, y: 1000 })
    // a floor plant 30cm off the table is close, but it is not a table
    const v = checkPlacement(scene(), ghost('plant.potted', { x: 1000 + ROUND_R + 80, y: 1000 }))
    expect(kinds(v)).not.toContain('spacing')
  })
})

describe('venue bounds and no-go zones', () => {
  beforeEach(() => {
    newProject({ name: 'resort', venuePackId: 'resort' })
  })

  it('refuses a table over the pool instead of quietly shoving it out (§57)', () => {
    const centre = { x: POOL.x + POOL.width / 2, y: POOL.y + POOL.depth / 2 }
    const v = checkPlacement(scene(), ghost('table.round', centre))
    expect(kinds(v)).toContain('forbiddenZone')
    expect(v.find((x) => x.kind === 'forbiddenZone')).toMatchObject({ zone: 'pool' })
  })

  it('refuses a drop past the venue edge', () => {
    expect(kinds(checkPlacement(scene(), ghost('table.round', { x: 10, y: 10 })))).toContain('outOfBounds')
  })

  it('exempts a hung fixture from the floor zones, but not from the walls', () => {
    const centre = { x: POOL.x + POOL.width / 2, y: POOL.y + POOL.depth / 2 }
    expect(checkPlacement(scene(), ghost('lamp.pendant', centre))).toEqual([])
    expect(kinds(checkPlacement(scene(), ghost('lamp.pendant', { x: -50, y: 500 })))).toContain('outOfBounds')
  })

  it('says nothing about a fixed station — its home zone decides, not the drop point', () => {
    expect(checkPlacement(scene(), ghost('dj.booth', { x: 300, y: 300 }))).toEqual([])
    expect(checkPlacement(scene(), ghost('bar.resort-left', { x: 4000, y: 2400 }))).toEqual([])
  })
})

describe("the catalog's own siting rules", () => {
  beforeEach(() => {
    newProject({ name: 'resort', venuePackId: 'resort' })
  })

  /**
   * REVERSED in round 2, and the reversal is the assertion. §15 read "vegetation 2
   * goes only against walls", this entry carried `nearWall: 60`, and the two cases
   * here were the 60cm band either side. The corrections (§4, 2026-07-28) say the
   * opposite outright — it may stand wherever the user likes — so what is checked
   * now is that the middle of the room is legal AND that the field is gone from the
   * entry, which is what makes the old rule un-restorable by accident rather than
   * merely slack. The passage-wall case went with it: with no wall rule left it
   * asserted nothing.
   */
  it('lets vegetation 2 stand anywhere, wall or no wall (round-2 §4 reverses §15)', () => {
    const veg2 = getCatalogEntry('plant.potted-2')
    expect(veg2.nearWall).toBeUndefined()
    // out in the open, and against the hall's north wall along y = 0 — both fine
    expect(checkPlacement(scene(), ghost('plant.potted-2', { x: 500, y: 700 }))).toEqual([])
    expect(checkPlacement(scene(), ghost('plant.potted-2', { x: 500, y: 40 }))).toEqual([])
    // round 3 re-verified §6 ("vegetation 2 can go wherever you want") and found
    // nothing left to build: no wall rule, no zone list, no `zoneKind`. What it is
    // NOT is `placeAnywhere` — the pool is still water and still refuses it, the
    // same as it refuses a table. "No siting rule of its own" and "exempt from the
    // room's" are different claims, and only the first one was ever made.
    expect(veg2.allowedZones).toBeUndefined()
    expect(veg2.zoneKind).toBeUndefined()
    expect(veg2.placeAnywhere).toBeUndefined()
    const overWater = { x: POOL.x + POOL.width / 2, y: POOL.y + POOL.depth / 2 }
    expect(kinds(checkPlacement(scene(), ghost('plant.potted-2', overWater)))).toContain('forbiddenZone')
  })

  /**
   * Source doc §17. The figure is the only entry that answers to nothing, so the
   * cases are the four different rules it has to walk through: a no-go zone, the
   * inverted reception deck, the venue outline, and another object's footprint.
   */
  describe('the human figure stands anywhere (§17)', () => {
    const FIGURE = 'figure.woman'
    const DECK = pack.restricted!.find((z) => z.kind === 'kabalatPanim')!

    it('carries the flag rather than a zone rule', () => {
      const entry = getCatalogEntry(FIGURE)
      expect(entry.placeAnywhere).toBe(true)
      // both of these would confine it instead of freeing it — see the flag's note
      expect(entry.zoneKind).toBeUndefined()
      expect(entry.allowedZones).toBeUndefined()
    })

    it('stands in the pool, on the reception deck, off the floor and inside a table', () => {
      expect(
        checkPlacement(scene(), ghost(FIGURE, { x: POOL.x + POOL.width / 2, y: POOL.y + POOL.depth / 2 })),
      ).toEqual([])
      expect(
        checkPlacement(scene(), ghost(FIGURE, { x: DECK.x + DECK.width / 2, y: DECK.y + DECK.depth / 2 })),
      ).toEqual([])
      // past the venue edge: §17 says "including places other elements are not
      // allowed", and the outline is one of those places
      expect(checkPlacement(scene(), ghost(FIGURE, { x: -200, y: -200 }))).toEqual([])
      // standing where a table already is
      addObject('table.round', { x: 800, y: 700 })
      expect(checkPlacement(scene(), ghost(FIGURE, { x: 800, y: 700 }))).toEqual([])
    })

    it('is on the deck whitelist, so the clamp settles it there instead of ejecting it', () => {
      // second argument: is the LIVE ceremony pad the deck's one? A default
      // project is 'hall', so it is not — and for everything that is not a canopy
      // the answer changes nothing. `venueZones.test.ts` owns the canopy's case.
      expect(allowedOnDeck(getCatalogEntry(FIGURE), false)).toBe(true)
    })
  })

  /**
   * Source doc §29 — and the reason it needs cases of its own is that the rule
   * lives on a CEILING entry, whose exemption from the floor rules used to
   * swallow `allowedZones` whole before it was ever read.
   */
  describe('the lamp cluster hangs over the bar and nowhere else (§29)', () => {
    const CLUSTER = 'lamp.pendant-cluster'
    const BAR = pack.restricted!.find((z) => z.kind === 'bar')!
    const overBar = { x: BAR.x + BAR.width / 2, y: BAR.y + BAR.depth / 2 }

    it('names the bar zone with `allowedZones`, never with `zoneKind`', () => {
      const entry = getCatalogEntry(CLUSTER)
      expect(entry.allowedZones).toEqual([{ kind: 'bar', within: 0 }])
      // a `zoneKind` here would make clampToVenue's home-zone branch `continue`
      // before the ceiling branch that snaps to the truss (state/actions.ts:379-422),
      // and the cluster would hang between beams with nothing failing
      expect(entry.zoneKind).toBeUndefined()
    })

    it('accepts a drop over the bar and refuses one over the dance floor', () => {
      expect(checkPlacement(scene(), ghost(CLUSTER, overBar))).toEqual([])
      const dance = pack.restricted!.find((z) => z.kind === 'dancefloor')!
      const v = checkPlacement(scene(), ghost(CLUSTER, { x: dance.x + dance.width / 2, y: dance.y + dance.depth / 2 }))
      expect(kinds(v)).toEqual(['wrongZone'])
      expect(v[0]).toMatchObject({ allowed: ['bar'] })
    })

    it('leaves the other four fixtures hanging wherever they like', () => {
      const free = pack.restricted!.find((z) => z.kind === 'dancefloor')!
      const centre = { x: free.x + free.width / 2, y: free.y + free.depth / 2 }
      for (const id of ['lamp.pendant', 'lamp.chandelier-diamond', 'lamp.chandelier-basket', 'lamp.chandelier-candelabra']) {
        expect(checkPlacement(scene(), ghost(id, centre)), id).toEqual([])
      }
    })

    it('still snaps to the ceiling beams — the whole point of not using `zoneKind`', () => {
      const id = addObject(CLUSTER, overBar)
      const placed = scene().objects[id].transform.position
      const grid = beamGrid(pack, scene().venue.size)
      expect(placed).toEqual(snapToBeam(placed, grid))
    })
  })

  it('refuses a napkin with no place setting under it, and accepts one with (§27)', () => {
    const table = addObject('table.round', { x: 500, y: 500 })
    const napkin = 'decor.napkin-white'
    expect(getCatalogEntry(napkin).requiresHost).toBe('decor.place-setting')

    const bare = checkPlacement(scene(), { ...ghost(napkin, { x: 0, y: 0 }), parentId: table })
    expect(kinds(bare)).toEqual(['missingHost'])

    addSeatItemsToTable('decor.place-setting', table)
    const dressed = checkPlacement(scene(), { ...ghost(napkin, { x: 0, y: 0 }), parentId: table })
    expect(dressed).toEqual([])
  })

  it('allows one chuppah and refuses the next, whatever the model (§62)', () => {
    addObject('chuppah.draped-white', { x: 2000, y: 1800 })
    const v = checkPlacement(scene(), ghost('chuppah.round-beige', { x: 2000, y: 1800 }))
    expect(kinds(v)).toEqual(['duplicate'])
    expect(v[0]).toMatchObject({ unique: 'chuppah' })
  })
})

describe('slideToLegal', () => {
  it('stops at the obstacle instead of giving up on the whole move', () => {
    addObject('table.round', { x: 2000, y: 1000 })
    const from = { x: 500, y: 1000 }
    const to = { x: 2000, y: 1000 }
    const landed = slideToLegal(scene(), ghost('table.round', to), from)
    expect(landed).not.toBeNull()
    expect(landed!.x).toBeGreaterThan(from.x)
    expect(landed!.x).toBeLessThan(to.x)
    expect(checkPlacement(scene(), ghost('table.round', landed!))).toEqual([])
  })

  it('returns the target untouched when the whole move is legal', () => {
    const to = { x: 900, y: 900 }
    expect(slideToLegal(scene(), ghost('table.round', to), { x: 500, y: 500 })).toEqual(to)
  })

  it('gives up only when the starting point is illegal too', () => {
    expect(slideToLegal(scene(), ghost('table.round', { x: 10, y: 10 }), { x: -500, y: -500 })).toBeNull()
  })
})

/**
 * Round 4 §15b — the serpentine is judged by its BAND, not by the box around it.
 *
 * Its `outline` is a 422.00 × 426.41 cm rect (17.99 m²) around a band of 4.644 m²,
 * and the box's own centre is 63.13 cm outside the drape. `TABLE_CLEARANCE.rect`
 * is 170 and correct — it is a real aisle between table EDGES — but measured off
 * that box it refused a ⌀180 round table up to about three metres from the cloth.
 * The outline stays for its nine other consumers; collision alone reads the
 * sectors, tiled by `serpentineBandTiles`.
 *
 * Every row states the gap to the REAL band, computed from `serpentineBandDepth`
 * rather than written down, so a re-fit of the arcs moves the expectation with it.
 */
describe('the serpentine is judged by its band (§15b)', () => {
  const ORIGIN = { x: 1600, y: 1500 }
  const ROUND = getCatalogEntry('table.round').defaultSize.width / 2
  /** Read, never written down: the serpentine states its own aisle (PLAN-07 §4.1). */
  const SERP_AISLE = getCatalogEntry('table.serpentine').clearance!

  /** Edge-to-edge gap between the ⌀180 at this offset and the real band. */
  const gapToBand = (dx: number, dy: number) => -serpentineBandDepth({ x: dx, y: dy }) - ROUND

  const roundAt = (dx: number, dy: number) =>
    ghost('table.round', { x: ORIGIN.x + dx, y: ORIGIN.y + dy })

  const place = () => addObject('table.serpentine', ORIGIN)

  // Measured 2026-07-30. Before the tiling every one of these was `collision`,
  // including the first two, which are a clear two metres from the drape.
  it.each([
    [210, -212, 212.1, []],
    [177, -177, 170.4, []],
    [150, -150, 137.6, ['spacing']],
    [106, -106, 86.6, ['spacing']],
    [0, 0, -1, ['collision']],
  ] as const)('a ⌀180 at (%s, %s), %s cm from the band', (dx, dy, gap, expected) => {
    place()
    if (gap > 0) expect(gapToBand(dx, dy)).toBeCloseTo(gap, 0)
    else expect(serpentineBandDepth({ x: dx, y: dy })).toBeLessThan(ROUND)
    expect(kinds(checkPlacement(scene(), roundAt(dx, dy)))).toEqual(expected)
  })

  it('names the real aisle when it does refuse on spacing', () => {
    place()
    const v = checkPlacement(scene(), roundAt(106, -106))
    // the entry's own aisle, not the one its rect outline would have implied
    expect(v[0]).toMatchObject({ kind: 'spacing', required: SERP_AISLE })
    // and the distance it reports is the distance to the BAND, not to the box —
    // within the tiling's own ≤5.3 cm outward over-claim
    if (v[0].kind !== 'spacing') throw new Error('expected a spacing violation')
    expect(Math.abs(v[0].actual - gapToBand(106, -106))).toBeLessThan(5.5)
  })

  /**
   * The clearest single number in the whole change. Due east of the origin the
   * band's own edge is far short of the box's, so measuring off the box would put
   * the first legal ⌀180 centre at 211 + 90 + aisle. It is much nearer than that,
   * and the aisle it lands on is still a full one measured to the drape.
   *
   * Two separate rounds moved this number and both are pinned here on purpose:
   * R4 §15b tiled the band (471 → 422.5 at the inherited 170 cm aisle), and R5
   * PLAN-07 replaced that inherited aisle with the 160 the user chose (→ 411.5).
   */
  it('measures the aisle from the band, not from the box the band sits in', () => {
    place()
    const outline = getCatalogEntry('table.serpentine').footprint(
      getCatalogEntry('table.serpentine').defaultSize,
    ).outline
    if (outline.kind !== 'rect') throw new Error('the serpentine declares a rect outline')
    const byTheBox = outline.w / 2 + ROUND + SERP_AISLE
    expect(byTheBox).toBeCloseTo(461, 0)

    let first = Infinity
    for (let x = 300; x < byTheBox + 1; x += 0.5) {
      if (!checkPlacement(scene(), roundAt(x, 0)).length) {
        first = x
        break
      }
    }
    expect(first).toBeCloseTo(411.5, 1)
    expect(byTheBox - first).toBeGreaterThan(40)
    // and it is still a real aisle of the full declared width, measured to the drape
    expect(gapToBand(first, 0)).toBeGreaterThanOrEqual(SERP_AISLE)
  })

  /** The chairs are still part of the footprint, and they are not tiled away. */
  it('keeps its 22 chairs in the obstacle set', () => {
    const id = place()
    const chairs = Object.values(scene().objects).filter(
      (o) => o.parentId === id && o.attachment?.kind === 'seat',
    )
    expect(chairs.length).toBe(22)
    for (const chair of chairs) {
      // a chair's stored transform is PARENT-LOCAL; the obstacle set holds it composed
      const world = composeTransform(scene().objects[id].transform, chair.transform)
      expect(kinds(checkPlacement(scene(), ghost('table.round', world.position))))
        .toContain('collision')
    }
  })
})

/**
 * PLAN-07 §4.2 — the rules read `mirrored`, which until now only the renderers and
 * `composeTransform` did.
 *
 * The serpentine is the only entry this can be seen on, and the only one it could
 * ever have been seen on: every other outline is symmetric about its own origin,
 * so reflecting it is a no-op. Its band is not, and the numbers the diagnostic of
 * §2 measured on the real hall are what these tests pin —
 *
 *   25 of its 30 band tiles were judged more than 40 cm from where they are drawn,
 *   the furthest 287.4 cm away; and the first legal centre of a mirrored serpentine
 *   against the hall's west wall moved by −39…+76 cm depending on where along the
 *   wall it stood, in ARBITRARY directions.
 *
 * That is the whole of "it will not let me put a table beside it" — the engine was
 * answering about a drape two and a half metres from the one on screen.
 */
describe('mirroring (E1/§4.2)', () => {
  const ORIGIN = { x: 1600, y: 1500 }
  const SERP = 'table.serpentine'

  /** The same probe on both sides of the table's own local y-axis. */
  const OFFSETS = [
    [150, -150],
    [210, -212],
    [106, -106],
    [260, 40],
    [0, 260],
    [-180, 120],
  ] as const

  it('judges a mirrored table as the exact mirror image of the plain one', () => {
    const id = addObject(SERP, ORIGIN)
    const plain = OFFSETS.map(([dx, dy]) =>
      checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x + dx, y: ORIGIN.y + dy })),
    )
    mirrorObjects([id])
    expect(scene().objects[id].transform.mirrored).toBe(true)
    // the reflected probe: local x negated, y kept — composeTransform's own rule
    const mirrored = OFFSETS.map(([dx, dy]) =>
      checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x - dx, y: ORIGIN.y + dy })),
    )
    for (let i = 0; i < OFFSETS.length; i++) {
      expect(kinds(mirrored[i])).toEqual(kinds(plain[i]))
      for (let j = 0; j < plain[i].length; j++) {
        const a = plain[i][j]
        const b = mirrored[i][j]
        if (a.kind !== 'spacing' || b.kind !== 'spacing') continue
        expect(b.required).toBe(a.required)
        // the same aisle to the same drape, to the last bit the geometry carries
        expect(Math.abs(b.actual - a.actual)).toBeLessThan(1e-9)
      }
    }
  })

  /**
   * The assertion the fix exists for: the band is judged WHERE IT IS DRAWN.
   *
   * Chairs stripped, so nothing but the drape can be what refuses — with them in
   * the set a table dropped on the band collides with a seat as often as with the
   * cloth, and the test would pass on the broken engine too. Run against the code
   * before this change, 25 of the 30 rows are legal.
   */
  it('puts every one of the 30 band tiles where the mirror draws it', () => {
    const id = bareTable(SERP, ORIGIN)
    mirrorObjects([id])
    const tiles = serpentineBandTiles()
    expect(tiles.length).toBe(30)
    for (const t of tiles) {
      // drawn = the local tile reflected in x, exactly as <Group scaleX={-1}> draws it
      const at = { x: ORIGIN.x - t.cx, y: ORIGIN.y + t.cy }
      expect(kinds(checkPlacement(scene(), ghost('table.round', at)))).toContain('collision')
    }
    // …and the UNreflected image, which is what the engine used to test, is now
    // free floor wherever the band does not happen to fold back onto itself
    const freed = tiles.filter(
      (t) =>
        !kinds(
          checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x + t.cx, y: ORIGIN.y + t.cy })),
        ).includes('collision'),
    )
    expect(freed.length).toBeGreaterThan(10)
  })

  it('leaves the round and the square tables byte-identical, mirrored or not', () => {
    // the proof that the change reached exactly one entry: their outlines are
    // symmetric about the origin, so reflecting them cannot move anything
    for (const catalogId of ['table.round', 'table.square', 'table.knights-480']) {
      newProject({ name: 'collision', venueWidth: 4000, venueDepth: 3000 })
      const id = addObject(catalogId, ORIGIN)
      const probes = [
        [300, 0],
        [0, 300],
        [-260, 140],
        [420, -420],
      ] as const
      const plain = probes.map(([dx, dy]) =>
        checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x + dx, y: ORIGIN.y + dy })),
      )
      mirrorObjects([id])
      expect(scene().objects[id].transform.mirrored).toBe(true)
      const after = probes.map(([dx, dy]) =>
        checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x + dx, y: ORIGIN.y + dy })),
      )
      expect(after).toEqual(plain)
    }
  })

  it('carries the reflection through a ROTATED table too', () => {
    // reflect-then-turn, not turn-then-reflect: at 37° the two differ by 74°, so a
    // test that only ever looked at rotation 0 would pass on either
    const id = addObject(SERP, ORIGIN)
    rotateObjectsBy([id], 37)
    const rotated = scene().objects[id].transform.rotation
    expect(rotated).toBeCloseTo(37, 6)
    const local = { x: 220, y: -140 }
    const plainWorld = composeTransform(scene().objects[id].transform, {
      position: local,
      rotation: 0,
      elevation: 0,
    })
    const plain = checkPlacement(scene(), ghost('table.round', plainWorld.position))
    mirrorObjects([id])
    const mirroredWorld = composeTransform(scene().objects[id].transform, {
      position: local,
      rotation: 0,
      elevation: 0,
    })
    const after = checkPlacement(scene(), ghost('table.round', mirroredWorld.position))
    expect(kinds(after)).toEqual(kinds(plain))
  })
})

/**
 * PLAN-07 §2 — the diagnostic, kept as assertions once it had printed.
 *
 * Run in the REAL hall on purpose: the procedural room this file builds everywhere
 * else has no zones and no baked fixtures, and both turned out to matter. These
 * are the numbers the clearance decision was put to the user with, so they are
 * pinned — a silent drift in any of them would invalidate the choice he makes.
 */
describe('the serpentine in the real hall (E1/§2)', () => {
  const SERP = 'table.serpentine'
  const ORIGIN = { x: 700, y: 700 }

  beforeEach(() => {
    newProject({ name: 'E1', venuePackId: 'resort' })
  })

  const judgedBox = (id: string) => {
    const s = scene()
    const boxes = [objectAABB(s, id)!]
    for (const o of Object.values(s.objects)) {
      if (o.parentId === id && o.attachment?.kind === 'seat') boxes.push(objectAABB(s, o.id)!)
    }
    return boxes.reduce((a, b) => ({
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    }))
  }

  const probe = (id: string, position: Vec2) => {
    const o = scene().objects[id]
    return checkPlacement(scene(), {
      catalogId: o.catalogId,
      transform: { ...o.transform, position },
      size: o.size,
      excludeId: id,
      subtreeOf: id,
    })
  }

  /**
   * §3.6a's four numbers. The gate measures the box on the RIGHT of each pair and
   * the snap lines used to offer the one on the left — which is the whole of "the
   * line is on the wall and the table stops 38 cm short of it".
   */
  it('is judged by a 477.4 × 502.2 box that is not centred on its own origin', () => {
    const id = addObject(SERP, ORIGIN)
    const judged = judgedBox(id)
    const outline = objectAABB(scene(), id)!
    expect(judged.maxX - judged.minX).toBeCloseTo(477.4, 1)
    expect(judged.maxY - judged.minY).toBeCloseTo(502.2, 1)
    expect(ORIGIN.x - judged.minX).toBeCloseTo(226.9, 1)
    expect(judged.maxX - ORIGIN.x).toBeCloseTo(250.5, 1)
    expect(ORIGIN.y - judged.minY).toBeCloseTo(251.0, 1)
    expect(judged.maxY - ORIGIN.y).toBeCloseTo(251.2, 1)
    // the outline box the snap lines used to use, and the gap that made
    expect(outline.maxX - ORIGIN.x).toBeCloseTo(211.0, 1)
    expect(judged.maxX - outline.maxX).toBeCloseTo(39.5, 1)
  })

  /**
   * §3.5's rejected hypothesis, pinned so nobody re-opens it: the serpentine goes
   * FLUSH against the wall — the refusal one millimetre closer is `outOfBounds`,
   * which is its chairs touching the wall and is the correct answer.
   */
  it('stands flush against the north wall, refused only by its own chairs', () => {
    const id = addObject(SERP, ORIGIN)
    const reach = ORIGIN.y - judgedBox(id).minY
    expect(probe(id, { x: 700, y: reach })).toEqual([])
    expect(kinds(probe(id, { x: 700, y: reach - 1 }))).toEqual(['outOfBounds'])
  })

  /**
   * ⚠ THE FINDING §2.2's decision table has no row for, and the real answer to "it
   * will not let me put it against the wall".
   *
   * The resort's west and north walls are lined with BAKED potted plants, roughly
   * every 3–4 m, standing 4–86 cm out from the wall. The serpentine's judged
   * footprint is wider than every gap between them, so along most of the wall what
   * refuses it is a `collision` with a venue fixture — not a rule, and nothing in
   * this plan changes it. The one clear x is the assertion above.
   */
  it('is stopped along the rest of the wall by baked planters, not by a rule', () => {
    const id = addObject(SERP, ORIGIN)
    const reach = ORIGIN.y - judgedBox(id).minY
    // every gap between two neighbouring north-wall planters is narrower than the
    // table's own judged width, so it cannot slot between them
    // the west floor area only (venuePacks floorAreas[0], x 0…1790) — the one the
    // table above is standing in, and the one the user was trying to fill
    const planters = Object.values(scene().objects)
      .filter((o) => !o.parentId && o.catalogId === 'plant.potted-2')
      .map((o) => objectAABB(scene(), o.id)!)
      .filter((b) => b.minY < 200 && b.maxX < 1790)
      .sort((a, b) => a.minX - b.minX)
    expect(planters.length).toBeGreaterThanOrEqual(3)
    const width = 477.4
    for (let i = 1; i < planters.length; i++) {
      expect(planters[i].minX - planters[i - 1].maxX).toBeLessThan(width)
    }
    // …and that is what the refusal names, at an x between two of them
    const between = (planters[0].maxX + planters[1].minX) / 2
    const v = probe(id, { x: between, y: reach })
    expect(v.some((x) => x.kind === 'collision')).toBe(true)
  })

  /**
   * The measurement the clearance decision was made from (§2.2), and now the
   * decision itself, in one assertion.
   *
   * The band-to-band aisle the rule measures and the aisle a guest can actually
   * walk down are NOT the same number, because the serpentine's chairs stand
   * 250.5 cm from its centre while its drape reaches only ~211. That gap is why
   * the number is chosen and not inherited: at the old 170 the real
   * chair-back-to-chair-back walkway beside a ⌀180 was 31.5 cm, and at the 160 the
   * user picked it is 20.5 — against the 18.0 cm the app already considers normal
   * between two ⌀180 round tables, which is the line below.
   */
  it('records the aisle the clearance rule buys, and the one it does not', () => {
    const serp = addObject(SERP, ORIGIN)
    const judged = judgedBox(serp)
    const other = addObject('table.round', { x: 3000, y: 400 })
    const otherBox = judgedBox(other)
    const half = (otherBox.maxX - otherBox.minX) / 2

    let firstLegal = Infinity
    for (let dx = 150; dx <= 900; dx += 1) {
      if (!checkPlacement(scene(), ghost('table.round', { x: ORIGIN.x + dx, y: ORIGIN.y })).length) {
        firstLegal = dx
        break
      }
    }
    expect(firstLegal).toBe(412)
    expect(firstLegal - (judged.maxX - ORIGIN.x) - half).toBeCloseTo(20.5, 1)

    // the house norm the number above has to be judged against
    let roundToRound = Infinity
    for (let dx = 150; dx <= 900; dx += 1) {
      if (!checkPlacement(scene(), ghost('table.round', { x: 3000 + dx, y: 400 })).length) {
        roundToRound = dx
        break
      }
    }
    expect(roundToRound).toBe(300)
    expect(roundToRound - 2 * half).toBeCloseTo(18.0, 1)
  })

  /**
   * The floor under the whole clearance question: chair-to-chair COLLISION already
   * refuses a real ⌀180 until the centres are 325.4 cm apart, where the band gap is
   * 86.7. Any clearance at or below that changes nothing at all.
   */
  it('shows that a clearance below ~87 could not change anything', () => {
    addObject(SERP, ORIGIN)
    const round = addObject('table.round', { x: 3000, y: 400 })
    let clear = Infinity
    for (let dx = 150; dx <= 900; dx += 0.1) {
      const o = scene().objects[round]
      const v = checkPlacement(scene(), {
        catalogId: o.catalogId,
        transform: { ...o.transform, position: { x: ORIGIN.x + dx, y: ORIGIN.y } },
        size: o.size,
        excludeId: round,
        subtreeOf: round,
      })
      if (!v.some((x) => x.kind === 'collision')) {
        clear = dx
        break
      }
    }
    expect(clear).toBeCloseTo(325.4, 0)
  })
})

/**
 * PLAN-07 §4.1 — an entry may state its own service aisle.
 *
 * Exactly one entry sets `clearance` (the serpentine, at the 160 the user chose
 * from the §2 measurement), so the fallback is still the branch almost every scene
 * reaches and this is the only thing holding both of them open.
 */
describe('clearanceOf (E1/§4.1)', () => {
  const entryFor = (catalogId: string) => getCatalogEntry(catalogId)
  const outlineFor = (catalogId: string) => {
    const e = entryFor(catalogId)
    return e.footprint(e.defaultSize).outline
  }

  it('falls back to the outline shape when the entry says nothing', () => {
    expect(clearanceOf(entryFor('table.square'), outlineFor('table.square')))
      .toBe(TABLE_CLEARANCE.rect)
    expect(clearanceOf(entryFor('table.round'), outlineFor('table.round')))
      .toBe(TABLE_CLEARANCE.circle)
  })

  it('lets the serpentine override the aisle its rect outline would have given it', () => {
    // it still declares `rect`, and nine other consumers still need that box —
    // the override is the whole point: the aisle no longer follows from the box
    expect(outlineFor('table.serpentine').kind).toBe('rect')
    expect(entryFor('table.serpentine').clearance).toBe(160)
    expect(clearanceOf(entryFor('table.serpentine'), outlineFor('table.serpentine')))
      .toBe(160)
    expect(clearanceOf(entryFor('table.serpentine'), outlineFor('table.serpentine')))
      .not.toBe(TABLE_CLEARANCE.rect)
  })

  it('honours an explicit number over EITHER outline shape', () => {
    for (const catalogId of ['table.square', 'table.round']) {
      const entry = { ...entryFor(catalogId), clearance: 143 }
      expect(clearanceOf(entry, outlineFor(catalogId))).toBe(143)
    }
  })

  it('treats 0 as a real answer, not as "unset"', () => {
    // `??` and not `||` — a table that wants no aisle at all must be able to say so
    const entry = { ...entryFor('table.square'), clearance: 0 }
    expect(clearanceOf(entry, outlineFor('table.square'))).toBe(0)
  })

  it('leaves the serpentine as the only entry carrying the field', () => {
    // `clearance` is an override for a shape the two source-doc words do not
    // describe, not a knob to start tuning table by table. A second entry setting
    // it is a decision, and this is where it gets noticed.
    const set = listCatalog().filter((e) => e.clearance !== undefined).map((e) => e.id)
    expect(set).toEqual(['table.serpentine'])
  })
})

describe('the rules bite on real gestures', () => {
  it('stops a dragged table at the clearance line instead of on top of its neighbour', () => {
    const parked = addObject('table.round', { x: 2000, y: 1000 })
    const moving = addObject('table.round', { x: 500, y: 1000 })
    moveObjectsBy([moving], { x: 1500, y: 0 })
    const gap = objectAABB(scene(), parked)!.minX - objectAABB(scene(), moving)!.maxX
    expect(gap).toBeGreaterThanOrEqual(TABLE_CLEARANCE.circle - 0.5)
    expect(checkPlacement(scene(), { ...ghost('table.round', scene().objects[moving].transform.position), excludeId: moving })).toEqual([])
  })

  it('refuses a rotation that would drive a table into its neighbour', () => {
    addObject('table.banquet', { x: 1000, y: 1000 })
    const b = addObject('table.banquet', { x: 1000, y: 1000 + 120 + TABLE_CLEARANCE.rect })
    const before = scene().objects[b].transform.rotation
    rotateObjectsBy([b], 90) // the 240-long side swings toward the neighbour
    expect(scene().objects[b].transform.rotation).toBe(before)
  })

  /**
   * PLAN-09 item 15. The refusal above used to take the WHOLE selection down with
   * it — one blocked member cancelled the rotation for everybody, and said nothing
   * — which from the outside is indistinguishable from a gizmo stuck on detents.
   * Now the group is judged member by member, and the ones that stayed put are
   * counted out loud. `poseAllowed` is untouched: still all-or-nothing per object.
   */
  it('turns the members that can and leaves only the blocked one behind', () => {
    const banquet = getCatalogEntry('table.banquet').defaultSize
    addObject('table.banquet', { x: 1000, y: 1000 }) // the neighbour in the way
    // exactly one clearance away, so the 240-long side cannot swing into it
    const blocked = addObject('table.banquet', {
      x: 1000,
      y: 1000 + banquet.depth + TABLE_CLEARANCE.rect,
    })
    const free = [
      addObject('table.banquet', { x: 3000, y: 600 }),
      addObject('table.banquet', { x: 3000, y: 2400 }),
    ]
    useNoticeStore.setState({ message: '', seq: 0 })

    rotateObjectsBy([...free, blocked], 90)

    for (const id of free) expect(scene().objects[id].transform.rotation).toBe(90)
    expect(scene().objects[blocked].transform.rotation).toBe(0)
    // the half that makes a refusal readable rather than a rotation that "does nothing"
    expect(useNoticeStore.getState().message).toBe(strings.status.rotationRefused(1))
  })

  it('publishes the reason so the status bar can show it', () => {
    addObject('table.round', { x: 2000, y: 1000 })
    const moving = addObject('table.round', { x: 500, y: 1000 })
    moveObjectsBy([moving], { x: 1500, y: 0 })
    expect(useEditorStore.getState().scene).toBeDefined()
    // the refusal rides on the overlay store, which the status bar reads
    expect(kinds(checkPlacement(scene(), ghost('table.round', { x: 2000, y: 1000 }), ))).toContain('collision')
  })

  it('takes the napkins with the place settings they stand on (§27)', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const settings = addSeatItemsToTable('decor.place-setting', table)
    const napkins = addSeatItemsToTable('decor.napkin-white', table)
    expect(napkins).toHaveLength(settings.length)
    expect(napkins.length).toBeGreaterThan(0)
    // each napkin stands ON a setting, on the point that setting offers a rider
    // and above its height. `stackedPosition`, not the host's own point: since
    // round-3 §13 a napkin is pinned to the setting's PLATE, which is off-centre
    // in the cover — asserting the host's raw position here would freeze the very
    // defect that fix removed (BRIEF §1.7).
    for (const id of napkins) {
      const napkin = scene().objects[id]
      if (napkin.attachment?.kind !== 'surface') throw new Error('expected a surface child')
      const host = scene().objects[napkin.attachment.stackedOn!]
      expect(host.catalogId).toBe('decor.place-setting')
      expect(napkin.transform.position).toEqual(stackedPosition(host))
      expect(napkin.transform.elevation).toBeGreaterThan(host.transform.elevation)
    }
    removeObjects(settings)
    expect(napkins.filter((id) => scene().objects[id])).toHaveLength(0)
  })

  it('refuses to lay napkins on a bare table', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    expect(addSeatItemsToTable('decor.napkin-white', table)).toEqual([])
  })
})

describe('no retroactive enforcement (plan decision — old projects load as they are)', () => {
  it('leaves a scene that already overlaps exactly as it was', () => {
    const a = addObject('table.round', { x: 1000, y: 1000 })
    // reach past the actions layer the way a loaded project does
    useEditorStore.setState((s) => {
      const clone = JSON.parse(JSON.stringify(s.scene.objects[a]))
      clone.id = 'legacy-overlap'
      clone.transform.position = { x: 1020, y: 1000 }
      s.scene.objects[clone.id] = clone
      s.scene.objectOrder.push(clone.id)
    })
    expect(scene().objects['legacy-overlap'].transform.position).toEqual({ x: 1020, y: 1000 })
    expect(kinds(checkPlacement(scene(), { ...ghost('table.round', { x: 1020, y: 1000 }), excludeId: 'legacy-overlap' }))).toContain('collision')
  })

  it('still lets the user drag an already-illegal object, instead of freezing it', () => {
    const a = addObject('table.round', { x: 1000, y: 1000 })
    useEditorStore.setState((s) => {
      const clone = JSON.parse(JSON.stringify(s.scene.objects[a]))
      clone.id = 'legacy-overlap'
      clone.transform.position = { x: 1020, y: 1000 }
      s.scene.objects[clone.id] = clone
      s.scene.objectOrder.push(clone.id)
    })
    setPosition('legacy-overlap', { x: 1120, y: 1000 })
    expect(scene().objects['legacy-overlap'].transform.position.x).toBe(1120)
  })
})

/**
 * The table top is a place with rules of its own (PLAN-06). Until now a
 * surface/seat candidate left `check()` before any geometry ran, so two
 * centrepieces could be dropped into the same square centimetre.
 *
 * Every case below is one row of the plan's contract table. The four SKIPS matter
 * as much as the refusals: each names a pair that shares a spot BY DESIGN, and
 * turning any of them into a collision would refuse a placement the app performs
 * itself — laySeatItems lays the settings, §27 stacks the napkin on one, §46 puts
 * the arrangement on the ring table, §48 puts a piece through the open centre.
 */
describe('two items on the same table (PLAN-06)', () => {
  const DECOR = 'decor.candelabra-crystal'
  const DESIGN = 'design.candelabrum-crystal'
  const NAPKIN = 'decor.napkin-white'
  const SETTING = 'decor.place-setting'

  // How far a place setting has to stand from a centrepiece to clear it, derived
  // from both outlines rather than picked. The cover has already been rescaled once
  // (tableDecor.ts's uniform 0.8), and a hardcoded offset would quietly stop
  // separating them — the test would keep passing while testing nothing.
  const REACH = outlineR(DECOR) + getCatalogEntry(SETTING).defaultSize.width / 2
  const CLEAR_X = REACH + 10
  const HIT_X = REACH - 10

  // The candidate in the point-based cases is a place setting on purpose: it is
  // `surfaceAnchor: 'free'`, so it is judged where it is put. Every plain
  // centrepiece is `'center'` and lands in the middle whatever the pointer said,
  // which is its own pair of cases further down.
  it('catches two table-top items in one another, and clears them once apart', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const standing = surfaceChild(DECOR, table, { x: 0, y: 0 })
    expect(getCatalogEntry(SETTING).surfaceAnchor).toBe('free')

    const hit = checkPlacement(scene(), surfaceGhost(SETTING, table, { x: 0, y: 0 }))
    expect(kinds(hit)).toEqual(['overlapsSibling'])
    expect(hit[0]).toMatchObject({ id: standing })
    expect(checkPlacement(scene(), surfaceGhost(SETTING, table, { x: CLEAR_X, y: 0 }))).toEqual([])
  })

  it('counts a centrepiece against a place setting', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    // a cover pushed to the middle, which is where a centrepiece will land
    const setting = surfaceChild(SETTING, table, { x: 0, y: 0 })

    const v = checkPlacement(scene(), surfaceGhost(DECOR, table, { x: CLEAR_X, y: 0 }))
    expect(kinds(v)).toEqual(['overlapsSibling'])
    expect(v[0]).toMatchObject({ id: setting })
  })

  it('leaves two place settings alone — laySeatItems already spaces them', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const settings = addSeatItemsToTable(SETTING, table)
    const at = scene().objects[settings[0]].transform.position
    expect(checkPlacement(scene(), surfaceGhost(SETTING, table, at))).toEqual([])
  })

  it('lets a napkin stand on the setting it requires (§27)', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const settings = addSeatItemsToTable(SETTING, table)
    expect(getCatalogEntry(NAPKIN).requiresHost).toBe(SETTING)
    const at = scene().objects[settings[0]].transform.position
    expect(checkPlacement(scene(), surfaceGhost(NAPKIN, table, at))).toEqual([])
  })

  it('counts a napkin against a centrepiece that is NOT its host', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    addSeatItemsToTable(SETTING, table) // the host has to exist or missingHost wins
    const standing = surfaceChild(DECOR, table, { x: 0, y: 0 })

    const v = checkPlacement(scene(), surfaceGhost(NAPKIN, table, { x: 0, y: 0 }))
    expect(kinds(v)).toEqual(['overlapsSibling'])
    expect(v[0]).toMatchObject({ id: standing })
  })

  it('still refuses a hostless napkin before it looks at the neighbours at all', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    surfaceChild(DECOR, table, { x: 0, y: 0 })
    const v = checkPlacement(scene(), surfaceGhost(NAPKIN, table, { x: 0, y: 0 }))
    expect(kinds(v)).toEqual(['missingHost'])
  })

  /**
   * `autoHost` (round 4 §9). `ring.floral` keeps `requiresHost` — it is what the
   * sibling skip below, the `stackedOn` link and `surfaceBase` all read — but a
   * missing host no longer refuses, because the drop lays the inner table in the
   * same gesture. So the ghost over a BARE ⌀380 is green.
   *
   * ⚠ And only over a ⌀380. The exemption is tied to the table having a well to
   * lay the host in, so on a solid top the refusal stands — and now names the
   * inner table rather than the cutlery.
   */
  it('lets the ring arrangement onto a BARE ⌀380 — the drop lays its own table', () => {
    const table = addObject('table.round-large', { x: 1200, y: 1200 })
    expect(getCatalogEntry('ring.floral').requiresHost).toBe('ring.table')
    expect(getCatalogEntry('ring.floral').autoHost).toBe(true)
    const onTop = Object.values(scene().objects).filter(
      (o) => o.parentId === table && o.attachment?.kind === 'surface',
    )
    expect(onTop).toEqual([])
    expect(checkPlacement(scene(), surfaceGhost('ring.floral', table, { x: 0, y: 0 }))).toEqual([])
  })

  it('still refuses it on a table with no well, and names the inner table', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const outline = getCatalogEntry('table.round').footprint(
      getCatalogEntry('table.round').defaultSize,
    ).outline
    expect(holeRadius(outline)).toBe(0)
    const v = checkPlacement(scene(), surfaceGhost('ring.floral', table, { x: 0, y: 0 }))
    expect(kinds(v)).toEqual(['missingHost'])
    expect(v[0]).toMatchObject({ requires: 'ring.table' })
  })

  it('keeps the ring arrangement and the table it stands on out of each other (§46)', () => {
    const table = addObject('table.round-large', { x: 1200, y: 1200 })
    expect(getCatalogEntry('ring.floral').requiresHost).toBe('ring.table')
    surfaceChild('ring.table', table, { x: 0, y: 0 }, { inHole: true })

    // Dropped out on the RIM — halfway between the edge of the well and the edge of
    // the table, so the pointer is demonstrably OVER THE TOP and not over the
    // opening. Both pieces are centre-anchored, so both land in the well anyway,
    // and neither the spot nor the storey may be taken from the pointer.
    const outline = getCatalogEntry('table.round-large').footprint(
      getCatalogEntry('table.round-large').defaultSize,
    ).outline
    if (outline.kind !== 'circle') throw new Error('the ⌀380 is a ring')
    const rim = { x: (holeRadius(outline) + outline.r) / 2, y: 0 }
    expect(rim.x).toBeGreaterThan(holeRadius(outline))
    expect(checkPlacement(scene(), surfaceGhost('ring.floral', table, rim))).toEqual([])
    // and it is the HOST relationship doing that, not the geometry: anything else
    // landing in the same well is refused
    expect(kinds(checkPlacement(scene(), surfaceGhost(DECOR, table, rim)))).toEqual([
      'overlapsSibling',
    ])
  })

  it('does not count a chair — it hangs off the table, not on it', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const chair = Object.values(scene().objects).find(
      (o) => o.parentId === table && o.attachment?.kind === 'seat',
    )
    expect(chair).toBeDefined()
    // free-anchored, so it really is judged AT the chair rather than at the centre
    expect(checkPlacement(scene(), surfaceGhost(SETTING, table, chair!.transform.position))).toEqual([])
  })

  it('keeps the open centre and the table top apart — they are two storeys (§48)', () => {
    const table = addObject('table.round-large', { x: 1200, y: 1200 })
    const inWell = surfaceChild('ring.table', table, { x: 0, y: 0 }, { inHole: true })
    expect(scene().objects[inWell].attachment).toMatchObject({ inHole: true })

    // the same point, probed from each storey
    expect(
      kinds(checkPlacement(scene(), { ...localProbe(DECOR, table, { x: 0, y: 0 }), inHole: true })),
    ).toEqual(['overlapsSibling'])
    expect(
      checkPlacement(scene(), { ...localProbe(DECOR, table, { x: 0, y: 0 }), inHole: false }),
    ).toEqual([])
  })

  it('READS a sibling’s storey instead of re-deriving it from the point', () => {
    // A piece on the TOP of a ring table, sitting over the opening. Deriving the
    // flag from its position would call it an in-well piece and swap which
    // candidates it blocks — the flag is decided once at drop (model/types.ts:53-55).
    const table = addObject('table.round-large', { x: 1200, y: 1200 })
    const onTop = surfaceChild(DECOR, table, { x: 0, y: 0 }, { inHole: false })
    // a plain surface attachment: on the top, carrying no well flag at all
    expect(scene().objects[onTop].attachment).toEqual({ kind: 'surface' })

    expect(
      checkPlacement(scene(), { ...localProbe('ring.table', table, { x: 0, y: 0 }), inHole: true }),
    ).toEqual([])
    expect(
      kinds(
        checkPlacement(scene(), { ...localProbe('ring.table', table, { x: 0, y: 0 }), inHole: false }),
      ),
    ).toEqual(['overlapsSibling'])
  })

  it('excludes the child being probed from its own siblings', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const decor = surfaceChild(DECOR, table, { x: 0, y: 0 })
    expect(
      checkPlacement(scene(), { ...localProbe(DECOR, table, { x: 0, y: 0 }), excludeId: decor }),
    ).toEqual([])
  })

  // `clampToSurface` pins a hand-placed centre-anchored piece to the middle of the
  // table whatever the pointer said (§28/§54), so a ghost judged at the pointer
  // answers the wrong question in BOTH directions. These two are that pair.
  it('refuses a centre-anchored design when the middle is taken, wherever the pointer is', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const middle = surfaceChild(DECOR, table, { x: 0, y: 0 })
    expect(getCatalogEntry(DESIGN).surfaceAnchor).toBe('center')

    // the rim spot really is empty — a free-anchored item is welcome there
    const rim = { x: CLEAR_X, y: 0 }
    expect(checkPlacement(scene(), surfaceGhost(SETTING, table, rim))).toEqual([])

    // the design dropped on that same empty rim still lands in the taken middle
    const v = checkPlacement(scene(), surfaceGhost(DESIGN, table, rim))
    expect(kinds(v)).toEqual(['overlapsSibling'])
    expect(v[0]).toMatchObject({ id: middle })
  })

  it('allows one over an occupied rim when the middle it will take is free', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    const rim = { x: CLEAR_X, y: 0 }
    surfaceChild(DECOR, table, rim) // a piece parked out on the rim

    // that spot is genuinely occupied for anything judged AT the pointer
    expect(kinds(checkPlacement(scene(), surfaceGhost(SETTING, table, rim)))).toEqual([
      'overlapsSibling',
    ])
    // but the design is not judged there — it lands in the middle, which is empty
    expect(checkPlacement(scene(), surfaceGhost(DESIGN, table, rim))).toEqual([])
  })

  it('judges an EXISTING centre-anchored child where it actually stands', () => {
    // The relocation above is for ghosts only. A design lays its pieces off-centre
    // and `clampToSurface` exempts them from the centre lock (its `meta.design`
    // branch) — but a candidate carries no `meta` to recognise them by, so moving
    // every centre-anchored probe to the origin would collapse a four-piece
    // arrangement into one point and report it as colliding with itself.
    const table = addObject('table.round', { x: 1000, y: 1000 })
    surfaceChild(DECOR, table, { x: 0, y: 0 })
    const arm = { x: CLEAR_X, y: 0 } // where a design would have put its outer piece
    expect(checkPlacement(scene(), localProbe(DECOR, table, arm))).toEqual([])
  })

  it('measures in the PARENT frame — a turned table answers both callers alike', () => {
    // The two callers speak different spaces: the ghost of a new drop is in world
    // coordinates, an existing child is parent-local. Turning the table is what
    // separates a real conversion from a subtraction that happens to work at 0°.
    const table = addObject('table.round', { x: 1200, y: 900 })
    rotateObjectsBy([table], 30)
    expect(scene().objects[table].transform.rotation).toBe(30)
    surfaceChild(DECOR, table, { x: 0, y: 0 })

    const hit = { x: HIT_X, y: 0 }
    const clear = { x: CLEAR_X, y: 0 }
    expect(kinds(checkPlacement(scene(), surfaceGhost(SETTING, table, hit)))).toEqual(['overlapsSibling'])
    expect(kinds(checkPlacement(scene(), localProbe(SETTING, table, hit)))).toEqual(['overlapsSibling'])
    expect(checkPlacement(scene(), surfaceGhost(SETTING, table, clear))).toEqual([])
    expect(checkPlacement(scene(), localProbe(SETTING, table, clear))).toEqual([])

    // the guard that makes the two above mean something: the WORLD numbers read as
    // if they were local land 1.5 metres away, so a missing conversion cannot pass
    const world = composeTransform(scene().objects[table].transform, {
      position: hit,
      rotation: 0,
      elevation: 0,
    })
    expect(checkPlacement(scene(), localProbe(DECOR, table, world.position))).toEqual([])
  })
})

/**
 * NaN survives every comparison in `check()` — `box.minX < -0.01` and the SAT
 * interval tests are all FALSE for it — so a non-finite pose would read as legal
 * and be written into the scene. Nothing but an explicit gate stops it.
 */
describe('a non-finite pose is refused outright', () => {
  it('refuses a floor candidate with a NaN coordinate', () => {
    expect(kinds(checkPlacement(scene(), ghost('table.round', { x: NaN, y: 1000 })))).toEqual([
      'outOfBounds',
    ])
    expect(kinds(checkPlacement(scene(), ghost('table.round', { x: 1000, y: NaN })))).toEqual([
      'outOfBounds',
    ])
  })

  it('refuses a NaN size', () => {
    const size = { ...getCatalogEntry('table.round').defaultSize, width: NaN }
    const v = checkPlacement(scene(), { ...ghost('table.round', { x: 1000, y: 1000 }), size })
    expect(kinds(v)).toEqual(['outOfBounds'])
  })

  it('refuses a table-top candidate too, which has no bounds rule of its own', () => {
    const table = addObject('table.round', { x: 1000, y: 1000 })
    surfaceChild('decor.candelabra-crystal', table, { x: 0, y: 0 })
    const v = checkPlacement(scene(), surfaceGhost('decor.candelabra-crystal', table, { x: NaN, y: 0 }))
    expect(kinds(v)).toEqual(['outOfBounds'])
  })

  it('does not slide toward a non-finite target', () => {
    expect(slideToLegal(scene(), ghost('table.round', { x: NaN, y: 1000 }), { x: 500, y: 1000 })).toBeNull()
  })
})

describe('performance — this runs on every drag frame', () => {
  it('answers a 40-table hall in well under a frame', () => {
    newProject({ name: 'full', venueWidth: 6000, venueDepth: 4000 })
    for (let i = 0; i < 40; i++) {
      addObject('table.round', { x: 300 + (i % 8) * 600, y: 300 + Math.floor(i / 8) * 600 })
    }
    const objects = Object.keys(scene().objects).length
    expect(objects).toBeGreaterThan(400) // 40 tables + their chairs

    const probe = ghost('table.round', { x: 5500, y: 3500 })
    checkPlacement(scene(), probe) // warm the catalog caches
    const started = performance.now()
    for (let i = 0; i < 20; i++) checkPlacement(scene(), probe)
    const perCall = (performance.now() - started) / 20
    expect(perCall).toBeLessThan(2) // measured 0.06ms on the dev machine
  })

  it('keeps a GATED drag frame inside a fraction of the 33ms budget', () => {
    // The real drag path, not just the predicate: every frame re-asks whether the
    // object is legal where it is, whether it may go where the pointer went, and
    // — once it is blocked — bisects for the contact point. Straight into a
    // neighbour, so the expensive branch runs on most frames.
    newProject({ name: 'full', venueWidth: 6000, venueDepth: 4000 })
    for (let i = 0; i < 24; i++) {
      addObject('table.round', { x: 1200 + (i % 6) * 700, y: 400 + Math.floor(i / 6) * 700 })
    }
    const mover = addObject('table.round', { x: 300, y: 400 })
    expect(checkPlacement(scene(), { ...ghost('table.round', { x: 300, y: 400 }), excludeId: mover })).toEqual([])

    moveObjectsBy([mover], { x: 1, y: 0 }) // warm
    const started = performance.now()
    for (let i = 0; i < 60; i++) moveObjectsBy([mover], { x: 15, y: 0 })
    const perFrame = (performance.now() - started) / 60
    // it did get stopped rather than sailing through
    expect(scene().objects[mover].transform.position.x).toBeLessThan(1200 - 180)
    expect(perFrame).toBeLessThan(8) // measured 3.8ms — ~11% of a 33ms frame
  })

  /**
   * The worst case round 4 §15b creates: the serpentine now carries THIRTY
   * collision shapes instead of one, dragged through a hall full of tables so the
   * bisection runs on most frames.
   *
   * Three changes landed in order to make that affordable, and this is what says
   * they did. Benchmarked on the dev machine (.tmp/bench-sat.mjs, 2M pairs): a
   * rect↔rect SAT costs 546 ns with its corners recomputed, 121 ns with them
   * cached and 6.4 ns to reject by boxes. Naive tiling would have multiplied the
   * 546 by thirty; caching the corners and rejecting each PAIR by its own box
   * pays for the tiles many times over.
   */
  it('drags a 30-tile serpentine through a full hall inside the frame budget', () => {
    newProject({ name: 'serp', venueWidth: 6000, venueDepth: 4000 })
    for (let i = 0; i < 24; i++) {
      addObject('table.round', { x: 1800 + (i % 6) * 700, y: 500 + Math.floor(i / 6) * 700 })
    }
    const mover = addObject('table.serpentine', { x: 400, y: 1400 })
    expect(
      checkPlacement(scene(), { ...ghost('table.serpentine', { x: 400, y: 1400 }), excludeId: mover }),
    ).toEqual([])

    moveObjectsBy([mover], { x: 1, y: 0 }) // warm
    const started = performance.now()
    for (let i = 0; i < 40; i++) moveObjectsBy([mover], { x: 15, y: 0 })
    const perFrame = (performance.now() - started) / 40
    // it really was stopped by the tables rather than sailing past them
    expect(scene().objects[mover].transform.position.x).toBeLessThan(1800)
    // measured 2.4-2.6 ms on the dev machine, against 3.8 for the plain round
    // table above. The bound is loose on purpose: a 40-frame sample on a busy
    // Windows box swings by a factor of two, and a flaky perf test is worse than
    // none. What is measured precisely is in .tmp/bench-sat.mjs.
    expect(perFrame).toBeLessThan(12)
  })
})

/**
 * Zones an entry is allowed INTO (PLAN-06, round-2 corrections §3ב, §4 and §27).
 *
 * A restricted rectangle used to mean one thing — nobody may stand here — with the
 * reception deck as the single hand-written exception. Two rules now share that
 * inverted shape and one loop in `check()`:
 *
 *  - the deck names the entries it lets in (`allowedOnDeck`);
 *  - an entry names the zones it belongs to (`allowedZones`), and is refused
 *    everywhere else by the band rule that follows.
 *
 * The cases that matter most are the ones where the exception does NOT spread: the
 * pool still refuses the vegetation whose ring touches it, and the deck still
 * refuses everything the whitelist leaves out.
 *
 * ⚠ Nothing here may assume the SHAPE of the surround. The pack held one bounding
 * box while this was written and PLAN-01C replaces it with the four rectangles the
 * user actually drew, so a test that names a corner of it passes today and fails on
 * the merge for a reason that has nothing to do with the rule. Points are SEARCHED
 * for against whatever the pack currently holds, and the assertions are about the
 * rule: somewhere in the surround is legal, the water is not, and the hall is not.
 */
describe('zones an entry is allowed into (PLAN-06)', () => {
  const SAVIV = pack.restricted!.filter((z) => z.kind === 'saviv')
  const POOLS = pack.restricted!.filter((z) => z.kind === 'pool')
  const DECK = pack.restricted!.find((z) => z.kind === 'kabalatPanim')!
  const PLANT = 'plant.potted'
  const deckCentre = { x: DECK.x + DECK.width / 2, y: DECK.y + DECK.depth / 2 }

  /** A point inside SOME saviv rectangle where the plant is fully legal, or null. */
  const legalRingPoint = (): Vec2 | null => {
    for (const z of SAVIV) {
      for (let x = z.x + 10; x <= z.x + z.width - 10; x += 20) {
        for (let y = z.y + 10; y <= z.y + z.depth - 10; y += 20) {
          if (!checkPlacement(scene(), ghost(PLANT, { x, y })).length) return { x, y }
        }
      }
    }
    return null
  }
  /** Plain hall floor — asserted clear of every rectangle so a moved zone shows up here. */
  const openHall = { x: 500, y: 700 }

  beforeEach(() => {
    newProject({ name: 'resort', venuePackId: 'resort' })
    for (const z of pack.restricted!) {
      const covered = openHall.x > z.x && openHall.x < z.x + z.width && openHall.y > z.y && openHall.y < z.y + z.depth
      expect(covered).toBe(false)
    }
  })

  it('lets vegetation 1 stand in the surround (§3ב)', () => {
    // The claim is that the ring is USABLE — that naming it in `allowedZones` buys a
    // real place to stand and not an empty intersection. Which point that is depends
    // on the pack, so it is searched for; what is asserted is that one exists and
    // that it is inside a rectangle the user painted as the surround.
    const point = legalRingPoint()
    expect(point).not.toBeNull()
    expect(checkPlacement(scene(), ghost(PLANT, point!))).toEqual([])
    const inSaviv = SAVIV.some(
      (z) => point!.x >= z.x && point!.x <= z.x + z.width && point!.y >= z.y && point!.y <= z.y + z.depth,
    )
    expect(inSaviv).toBe(true)
  })

  it('refuses vegetation 1 out in the hall — the ring is the only place it belongs', () => {
    const v = checkPlacement(scene(), ghost(PLANT, openHall))
    expect(kinds(v)).toEqual(['wrongZone'])
    expect(v[0]).toMatchObject({ allowed: ['saviv'] })
  })

  it('drops the rule entirely in a venue that HAS no such zone', () => {
    // "Vegetation 1 belongs around the pool" is a statement about a hall that has a
    // pool surround. In a procedural room there is no `saviv` rectangle, so the rule
    // is not failed — it is not evaluable, and the plant is placed freely. Exactly
    // what `zoneKind` says of itself (catalog/types.ts:188-193). Reading an empty
    // zone list as "nowhere is allowed" made vegetation 1 unplaceable in every venue
    // but the resort — Dashboard's own sample project among them.
    newProject({ name: 'procedural', venueWidth: 4000, venueDepth: 3000 })
    expect(getVenuePack(scene().venue.venuePackId)).toBeUndefined()
    expect(getCatalogEntry(PLANT).allowedZones).toHaveLength(1)
    expect(checkPlacement(scene(), ghost(PLANT, { x: 1000, y: 1000 }))).toEqual([])
  })

  it('still refuses vegetation 1 over the WATER — naming one zone opens only that one', () => {
    // Middle of the water, whatever shape the water is. The point of the assertion is
    // that `pool` is named as the refusal: the exemption is per-zone-per-entry, not a
    // blanket "this entry ignores restricted rectangles". Whether a `wrongZone` joins
    // it depends on how far the surround reaches, and that is not what is under test.
    for (const water of POOLS) {
      const v = checkPlacement(
        scene(),
        ghost(PLANT, { x: water.x + water.width / 2, y: water.y + water.depth / 2 }),
      )
      expect(v.some((x) => x.kind === 'forbiddenZone' && x.zone === 'pool')).toBe(true)
    }
  })

  it('holds vegetation 2 to no zone at all (§4)', () => {
    expect(getCatalogEntry('plant.potted-2').allowedZones).toBeUndefined()
    expect(getCatalogEntry('plant.potted-2').nearWall).toBeUndefined()
    expect(checkPlacement(scene(), ghost('plant.potted-2', openHall))).toEqual([])
  })

  it('lets a guest table stand on the reception deck (§27)', () => {
    expect(allowedOnDeck(getCatalogEntry('table.round'), false)).toBe(true)
    expect(checkPlacement(scene(), ghost('table.round', deckCentre))).toEqual([])
  })

  it('keeps the buffet on the deck, which the category line alone would not', () => {
    // `buffet.table` is filed with the service furniture, not the guest tables, so
    // the explicit id in `allowedOnDeck` is load-bearing rather than redundant.
    expect(getCatalogEntry('buffet.table').category).toBe('bars')
    expect(allowedOnDeck(getCatalogEntry('buffet.table'), false)).toBe(true)
    expect(checkPlacement(scene(), ghost('buffet.table', deckCentre))).toEqual([])
  })

  it('leaves everything else off the deck', () => {
    // A bar unit carries `zoneKind`, so it leaves check() at the fixed-station line
    // and the deck never judges it — the whitelist is the only thing to assert here,
    // and the eviction itself is state/kabalatPanim.test.ts's job.
    // was `bar.straight` when this was written; that id retired at v10 and
    // getCatalogEntry now throws on it. Any of the three pieces that replaced it
    // makes the same point — a bar unit is not welcome on the deck.
    expect(allowedOnDeck(getCatalogEntry('bar.resort-left'), false)).toBe(false)
    expect(allowedOnDeck(getCatalogEntry('divider.screen'), false)).toBe(false)
    const v = checkPlacement(scene(), ghost('divider.screen', deckCentre))
    expect(kinds(v)).toEqual(['forbiddenZone'])
    expect(v[0]).toMatchObject({ zone: 'kabalatPanim' })
  })

  it('shows that what stops a second chuppah is `unique`, not the deck (§27)', () => {
    // Half of §27 — "it will not let me put a chuppah on the reception deck" — is
    // not a zone rule at all. A chuppah carries `zoneKind`, so it leaves check()
    // before any rectangle is consulted; the refusal the user hit is the
    // one-per-scene tag, and it bites in the hall exactly as hard as on the deck.
    expect(checkPlacement(scene(), ghost('chuppah.draped-white', deckCentre))).toEqual([])
    addObject('chuppah.draped-white', { x: 2000, y: 1800 })
    expect(kinds(checkPlacement(scene(), ghost('chuppah.round-beige', deckCentre)))).toEqual(['duplicate'])
    expect(kinds(checkPlacement(scene(), ghost('chuppah.round-beige', { x: 300, y: 300 })))).toEqual(['duplicate'])
  })
})

/**
 * כסא אורחים חופה (PLAN-04) — "the chair/s can only be placed on the dance floor
 * and in the reception area."
 *
 * ⚠ EVERY case here needs `venuePackId: 'resort'`. The file's default project is a
 * bare 4000×3000 room with NO zones at all, and in a room with no zones an
 * `allowedZones` rule cannot fire in either direction — the whole group would pass
 * while saying nothing.
 */
describe('כסא אורחים חופה', () => {
  const CHAIR = 'chair.chuppah-guest'
  const DANCE = pack.restricted!.find((z) => z.kind === 'dancefloor')!
  const DECK2 = pack.restricted!.find((z) => z.kind === 'kabalatPanim')!
  const DECK_PAD = pack.restricted!.find(
    (z) => z.kind === 'chuppah' && z.x > DECK2.x && z.x < DECK2.x + DECK2.width,
  )!
  const POOL2 = pack.restricted!.find((z) => z.kind === 'pool')!
  const mid = (z: { x: number; y: number; width: number; depth: number }) => ({
    x: z.x + z.width / 2,
    y: z.y + z.depth / 2,
  })

  beforeEach(() => {
    newProject({ name: 'chuppah chair', venuePackId: 'resort' })
  })

  it('stands in the middle of the dance floor', () => {
    expect(checkPlacement(scene(), ghost(CHAIR, mid(DANCE)))).toEqual([])
  })

  it('stands on the reception deck', () => {
    expect(checkPlacement(scene(), ghost(CHAIR, mid(DECK2)))).toEqual([])
  })

  it('is refused on open hall floor, and told which zones it belongs to', () => {
    const v = checkPlacement(scene(), ghost(CHAIR, { x: 500, y: 700 }))
    expect(kinds(v)).toEqual(['wrongZone'])
    expect(v[0]).toMatchObject({ allowed: ['dancefloor', 'kabalatPanim'] })
  })

  it('is refused in the pool for TWO separate reasons', () => {
    // `allowedZones` opens the zones it names and nothing else: the pool still
    // forbids, and the band rule still says the chair is not where it belongs
    const v = checkPlacement(scene(), ghost(CHAIR, { x: 1200, y: 2000 }))
    expect(kinds(v)).toContain('wrongZone')
    expect(v).toContainEqual({ kind: 'forbiddenZone', zone: 'pool' })
    expect(POOL2.x).toBeLessThan(1200)
  })

  /**
   * The ceremony pad drawn on the deck blocks the chair too — being welcome on the
   * deck is not being welcome on the pad, exactly as it is for a guest table
   * (kabalatPanim.test.ts). ⚠ With "חופה למטה" that pad is not in the list at all,
   * so the case has to name its ceremony (PLAN-03).
   */
  it('is refused on the deck ceremony pad while the ceremony is up there', () => {
    setChuppahLocation('reception')
    expect(checkPlacement(scene(), ghost(CHAIR, mid(DECK_PAD)))).toContainEqual({
      kind: 'forbiddenZone',
      zone: 'chuppah',
    })
  })

  /**
   * The half that lives in the CLAMP. Without the category on `allowedOnDeck`,
   * `checkPlacement` says yes up here while `clampToVenue` declines to clamp the
   * chair in — so one dropped on the deck's edge hangs over it and
   * `standingHeightAt` flips it between 0 and 470 as its centre crosses the line.
   */
  it('is on the deck whitelist, and therefore clamped INTO the deck', () => {
    expect(allowedOnDeck(getCatalogEntry(CHAIR), false)).toBe(true)
    expect(allowedOnDeck(getCatalogEntry(CHAIR), true)).toBe(true)
    const edge = { x: DECK2.x + 10, y: DECK2.y + 10 }
    const id = addObject(CHAIR, edge)
    const b = objectAABB(scene(), id)!
    expect(b.minX).toBeGreaterThanOrEqual(DECK2.x - 0.01)
    expect(b.minY).toBeGreaterThanOrEqual(DECK2.y - 0.01)
    expect(b.maxX).toBeLessThanOrEqual(DECK2.x + DECK2.width + 0.01)
    expect(b.maxY).toBeLessThanOrEqual(DECK2.y + DECK2.depth + 0.01)
  })

  /**
   * ⭐ Touching is enough, and it is the user's ruling: a chair half over the dance
   * floor's edge is allowed. `within: 0` says "touching or overlapping" because
   * `shapeGap` is never negative (collision.ts:314) — so this is not a tolerance,
   * it is the rule.
   */
  it('may hang half off the dance floor’s edge', () => {
    const edge = { x: DANCE.x + DANCE.width, y: DANCE.y + DANCE.depth / 2 }
    expect(checkPlacement(scene(), ghost(CHAIR, edge))).toEqual([])
  })

  /**
   * STOPS ON THE BOUNDARY, does not freeze at the start of the gesture. No new
   * code: `slideToLegal` bisects and hands back the legal part of the move.
   */
  it('slides to the edge when dragged out of the dance floor', () => {
    const from = mid(DANCE)
    const far = { x: DANCE.x - 600, y: from.y }
    const stop = slideToLegal(scene(), { catalogId: CHAIR, transform: { position: far, rotation: 0, elevation: 0 }, size: getCatalogEntry(CHAIR).defaultSize }, from)
    expect(stop).not.toBeNull()
    expect(stop!.x).toBeLessThan(from.x)
    expect(stop!.x).toBeGreaterThan(far.x)
    expect(checkPlacement(scene(), ghost(CHAIR, stop!))).toEqual([])
  })

  /** Assertion 14: one chair, and the refusal says so. */
  it('refuses a second one and hands back the first', () => {
    const first = addObject(CHAIR, mid(DANCE))
    const again = addObject(CHAIR, mid(DECK2))
    expect(again).toBe(first)
    expect(Object.values(scene().objects).filter((o) => o.catalogId === CHAIR)).toHaveLength(1)
    expect(useEditorStore.getState().selection).toEqual([first])
    expect(kinds(checkPlacement(scene(), ghost(CHAIR, mid(DECK2))))).toEqual(['duplicate'])
  })
})
