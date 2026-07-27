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
import { getCatalogEntry } from '../catalog/registry'
import { getVenuePack } from '../venuePacks'
import type { SceneState, Vec2 } from '../model/types'
import {
  addObject,
  addSeatItemsToTable,
  moveObjectsBy,
  newProject,
  removeObjects,
  rotateObjectsBy,
  setPosition,
} from '../../state/actions'
import { objectAABB } from '../../state/selectors'
import { useEditorStore } from '../../state/store'
import { checkPlacement, slideToLegal, TABLE_CLEARANCE, type Violation } from './collision'

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
    expect(checkPlacement(scene(), ghost('bar.straight', { x: 4000, y: 2400 }))).toEqual([])
  })
})

describe("the catalog's own siting rules", () => {
  beforeEach(() => {
    newProject({ name: 'resort', venuePackId: 'resort' })
  })

  it('keeps vegetation 2 against a wall (§15)', () => {
    const near = getCatalogEntry('plant.potted-2').nearWall!
    expect(near).toBeGreaterThan(0)
    // the hall's north wall runs along y = 0
    expect(kinds(checkPlacement(scene(), ghost('plant.potted-2', { x: 500, y: 30 })))).not.toContain('nearWall')
    expect(kinds(checkPlacement(scene(), ghost('plant.potted-2', { x: 500, y: 700 })))).toContain('nearWall')
  })

  it('lets the passage walls count too — it is a wall like any other (§15)', () => {
    const passage = pack.restricted!.find((z) => z.kind === 'passage')!
    // the passage is a corridor; its own side wall is part of the hall contour
    const atWall = { x: passage.x + passage.width - 40, y: passage.y + 200 }
    expect(kinds(checkPlacement(scene(), ghost('plant.potted-2', atWall)))).not.toContain('nearWall')
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
    // each napkin stands ON a setting, at its position and above its height
    for (const id of napkins) {
      const napkin = scene().objects[id]
      if (napkin.attachment?.kind !== 'surface') throw new Error('expected a surface child')
      const host = scene().objects[napkin.attachment.stackedOn!]
      expect(host.catalogId).toBe('decor.place-setting')
      expect(napkin.transform.position).toEqual(host.transform.position)
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
})
