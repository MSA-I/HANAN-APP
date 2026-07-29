/**
 * The ⌀380 ring table's 156 cm opening (source doc §48), and how it meets the
 * centre rule (§28).
 *
 * Those two land on the same spot: §28 puts a centrepiece in the middle of the
 * table, and on this table the middle is a hole — so it stands on the FLOOR and
 * rises through the opening rather than floating over it. A design is exempt from
 * §28, so a design-laid item is the case that still sits on the ring at table
 * height, and the one that proves `inHole` is honoured rather than assumed.
 *
 * The invariant worth pinning: nothing changes elevation on its own. `inHole` is
 * settled by the rules, and every later clamp reaches the same answer, so no drag
 * can silently drop a piece 75 cm.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { holeRadius } from '../core/layout/bounds'
import { addObject, addObjectToSurface, newProject, setPosition } from './actions'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const RING = 'table.round-large'
const SOLID = 'table.round'
const DECOR = 'decor.vase-ceramic'

const outlineOf = (catalogId: string) => {
  const e = getCatalogEntry(catalogId)
  return e.footprint(e.defaultSize).outline
}
const R_INNER = () => holeRadius(outlineOf(RING))
const R_OUTER = () => {
  const o = outlineOf(RING)
  return o.kind === 'circle' ? o.r : 0
}
/** how far the decor's own outline reaches from its centre */
const REACH = () => {
  const o = outlineOf(DECOR)
  return o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
}

const radius = (id: string) => {
  const p = scene().objects[id].transform.position
  return Math.hypot(p.x, p.y)
}

/**
 * ⚠ The two APIs take different frames: `addObjectToSurface` takes a WORLD point
 * (it derives the local one), while `setPosition` on a child writes
 * `transform.position` directly, which for an attached child is already
 * PARENT-LOCAL. Every drag below is local.
 */
const dragLocal = (id: string, x: number, y = 0) => setPosition(id, { x, y })

/**
 * Turn a child into what `layTableDesign` produces: tagged with a design id and
 * carrying a plain surface attachment. The tag is what exempts it from §28; the
 * reset matters because the hand drop that created it already resolved §28 and
 * committed it to the hole.
 */
const markAsDesign = (id: string) => {
  useEditorStore.setState((s) => {
    s.scene.objects[id].meta.design = 'test-design'
    s.scene.objects[id].attachment = { kind: 'surface' }
  })
}

beforeEach(() => {
  newProject({ name: 'ring', venuePackId: 'resort' })
})

describe('the ring table has a real opening', () => {
  it('reports an inner radius the solid table does not', () => {
    expect(R_INNER()).toBeGreaterThan(0)
    expect(holeRadius(outlineOf(SOLID))).toBe(0)
  })
})

/**
 * Source doc §26: "the circle that sits inside must cover the whole hole, there
 * must be no GAP". `ring.table` was ⌀149.7 — the raw bounds of its GLB — against a
 * ⌀156 opening, so 3 cm of floor showed all the way round. It is sized to the
 * OPENING now, and both numbers are read from the catalog here so neither can move
 * without the other (BRIEF §1.7).
 *
 * ⚠ The gap closes with no inner disc, and that is deliberate: the 2D layer draws a
 * real `Ring` with the floor showing through it (viewer2d/footprintShapes.tsx —
 * "a hole is a real hole"). Filling the hole in would have hidden a ⌀380 with
 * nothing in it. What closes the gap is the two radii being equal.
 */
describe('§26 — the ring-centre table covers the whole opening', () => {
  const RING_TABLE = 'ring.table'
  const radiusOf = (catalogId: string) => {
    const o = outlineOf(catalogId)
    return o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
  }

  it('is exactly as wide as the hole it fills — no floor left showing', () => {
    expect(radiusOf(RING_TABLE)).toBeCloseTo(R_INNER(), 6)
    // and the 2D shape really is a filled disc of that radius, not an annulus
    const e = getCatalogEntry(RING_TABLE)
    const parts = e.footprint(e.defaultSize).parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ kind: 'circle', r: R_INNER() })
    expect(holeRadius(outlineOf(RING_TABLE))).toBe(0)
  })

  it('stands flush with the ⌀380 it sits in', () => {
    expect(getCatalogEntry(RING_TABLE).defaultSize.height).toBe(
      getCatalogEntry(RING).defaultSize.height,
    )
  })

  /**
   * ⚠ THE SILENT TRAP (handoff/02-migration.md §6). The 3D loader fits a model by
   * `size / (modelSize ?? defaultSize)`. `ring.table` used to carry no `modelSize`,
   * so that ratio was 1 whatever the entry declared: growing `defaultSize` alone
   * would have left 3D rendering the old ⌀149.7 table inside a ⌀156 footprint —
   * the gap gone from the plan, still there in the viewport, and nothing failing.
   * This is the guard that makes deleting the field loud instead of silent.
   */
  it('states its FILE size too, so 3D grows the model instead of ignoring the change', () => {
    const { defaultSize, modelSize } = getCatalogEntry(RING_TABLE)
    if (!modelSize) throw new Error(`${RING_TABLE}: an entry sized to the hole must state its file's own size`)
    // it is genuinely a rescale — equal sizes would mean the field is decorative
    expect(modelSize.width).not.toBeCloseTo(defaultSize.width, 1)
    expect(defaultSize.width / modelSize.width).toBeGreaterThan(1)
    expect(defaultSize.height / modelSize.height).toBeLessThan(1)
  })

  it('drops into the well and covers it there too', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(RING_TABLE, table, { x: 1000, y: 700 })!
    const obj = scene().objects[child]
    // centred in the opening, standing on the floor through it
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.transform.elevation).toBe(0)
    // and the placed instance is still hole-wide, so the gap cannot come back via
    // a resize the inspector allowed
    expect(Math.max(obj.size.width, obj.size.depth) / 2).toBeGreaterThanOrEqual(R_INNER())
  })
})

describe('a hand-placed centrepiece', () => {
  it('stands on the floor through the opening of a ring table', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    // dropped well off-centre, on the ring
    const child = addObjectToSurface(DECOR, table, { x: 1000 + R_OUTER() - REACH() - 1, y: 700 })!
    const obj = scene().objects[child]
    // §28 pulls it to the middle, and the middle of THIS table is the hole
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.attachment).toEqual({ kind: 'surface', inHole: true })
    expect(obj.transform.elevation).toBe(0)
  })

  it('sits on the top of a solid table, not on the floor', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1060, y: 700 })!
    const obj = scene().objects[child]
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.attachment).toEqual({ kind: 'surface' })
    expect(obj.transform.elevation).toBe(scene().objects[table].size.height)
  })

  it('cannot be dragged out of the middle', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    for (const x of [40, 120, R_OUTER(), 900]) {
      dragLocal(child, x)
      expect(radius(child)).toBe(0)
      expect(scene().objects[child].transform.elevation).toBe(0)
    }
  })
})

describe('a design-laid item is exempt, and then the hole rules apply', () => {
  it('keeps a ring item on the top and clear of the opening', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000 + R_OUTER() - REACH() - 1, y: 700 })!
    markAsDesign(child)
    const top = scene().objects[table].size.height

    // aim straight through the middle to the far side — it never enters the hole
    for (const x of [R_OUTER(), 100, 40, 0, -40, -100, -R_OUTER()]) {
      dragLocal(child, x)
      const o = scene().objects[child]
      expect(o.transform.elevation).toBe(top)
      expect(radius(child)).toBeGreaterThanOrEqual(R_INNER() + REACH() - 0.01)
      expect(radius(child)).toBeLessThanOrEqual(R_OUTER() - REACH() + 0.01)
    }
  })

  it('keeps a hole item in the hole all the way out to the edge', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 }, true)!
    // design-laid THROUGH the opening: the tag lifts §28, `inHole` still holds
    useEditorStore.setState((s) => {
      s.scene.objects[child].meta.design = 'test-design'
      s.scene.objects[child].attachment = { kind: 'surface', inHole: true }
    })
    const maxR = Math.max(0, R_INNER() - REACH())
    for (const x of [40, 120, R_OUTER(), 400]) {
      dragLocal(child, x)
      expect(scene().objects[child].transform.elevation).toBe(0)
      expect(radius(child)).toBeLessThanOrEqual(maxR + 0.01)
    }
  })

  it('clamps only at the outer edge on a solid table', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    markAsDesign(child)
    const o = outlineOf(SOLID)
    const r = o.kind === 'circle' ? o.r : 0

    dragLocal(child, 0)
    expect(radius(child)).toBe(0) // dead centre is legal on a solid top

    dragLocal(child, 900)
    expect(radius(child)).toBeCloseTo(r - REACH(), 2)
    expect(scene().objects[child].transform.elevation).toBe(
      scene().objects[table].size.height,
    )
  })
})
