/**
 * Decor dropped through the open centre of the ⌀380 ring table (source doc §48).
 *
 * The one thing worth pinning here is that a piece never changes elevation on its
 * own: `attachment.inHole` is decided at drop and every later clamp honours it, so
 * dragging a centrepiece across the opening cannot silently drop it 75 cm to the
 * floor. The two regions are disjoint and each holds what was put in it.
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

const ringOutline = () => {
  const e = getCatalogEntry(RING)
  return e.footprint(e.defaultSize).outline
}
const R_INNER = () => holeRadius(ringOutline())
const R_OUTER = () => {
  const o = ringOutline()
  return o.kind === 'circle' ? o.r : 0
}
/** how far the decor's own outline reaches from its centre */
const REACH = () => {
  const e = getCatalogEntry(DECOR)
  const o = e.footprint(e.defaultSize).outline
  return o.kind === 'circle' ? o.r : Math.max(o.w, o.h) / 2
}

const radius = (id: string) => {
  const p = scene().objects[id].transform.position
  return Math.hypot(p.x, p.y)
}

/**
 * ⚠ The two APIs take different frames, and mixing them up makes a test pass for
 * the wrong reason: `addObjectToSurface` takes a WORLD point (it derives the local
 * one), while `setPosition` on a child writes `transform.position` directly, which
 * for an attached child is already PARENT-LOCAL. Every drag below is local.
 */
const dragLocal = (id: string, x: number, y = 0) => setPosition(id, { x, y })

beforeEach(() => {
  newProject({ name: 'ring', venuePackId: 'resort' })
})

describe('the ring table has a real opening', () => {
  it('reports an inner radius the solid table does not', () => {
    expect(R_INNER()).toBeGreaterThan(0)
    const solid = getCatalogEntry(SOLID)
    expect(holeRadius(solid.footprint(solid.defaultSize).outline)).toBe(0)
  })
})

describe('dropping into the opening', () => {
  /** table at a known spot, decor dropped `offset` cm from its centre */
  const place = (offset: number, inHole: boolean) => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000 + offset, y: 700 }, inHole)
    expect(child).not.toBeNull()
    return { table, child: child! }
  }

  it('stands a piece dropped in the centre on the floor', () => {
    const { child } = place(0, true)
    const obj = scene().objects[child]
    expect(obj.attachment).toEqual({ kind: 'surface', inHole: true })
    // parent-local: the table group's origin is the floor
    expect(obj.transform.elevation).toBe(0)
  })

  it('stands a piece dropped on the ring on the table top', () => {
    const { table, child } = place(R_OUTER() - REACH() - 1, false)
    const obj = scene().objects[child]
    expect(obj.attachment).toEqual({ kind: 'surface' })
    expect(obj.transform.elevation).toBe(scene().objects[table].size.height)
  })

  it('keeps a hole piece fully inside the opening', () => {
    const { child } = place(0, true)
    dragLocal(child, 900) // aimed well past the table edge
    expect(radius(child)).toBeCloseTo(Math.max(0, R_INNER() - REACH()), 2)
    expect(scene().objects[child].transform.elevation).toBe(0)
  })

  it('pushes a top piece clear of the opening instead of into it', () => {
    const { table, child } = place(R_OUTER() - REACH() - 1, false)
    dragLocal(child, 0) // dead centre of the table
    expect(radius(child)).toBeGreaterThanOrEqual(R_INNER() + REACH() - 0.01)
    expect(radius(child)).toBeLessThanOrEqual(R_OUTER() - REACH() + 0.01)
    expect(scene().objects[child].transform.elevation).toBe(scene().objects[table].size.height)
  })
})

describe('a drag never changes which region a piece belongs to', () => {
  it('leaves a top piece on the top all the way across the opening', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000 + R_OUTER() - REACH() - 1, y: 700 })!
    const top = scene().objects[table].size.height
    const inner = R_INNER() + REACH()
    // from the far edge, straight through the middle, out to the other side
    for (const x of [R_OUTER(), 100, 40, 0, -40, -100, -R_OUTER()]) {
      dragLocal(child, x)
      const o = scene().objects[child]
      expect(o.transform.elevation).toBe(top)
      expect(o.attachment).toEqual({ kind: 'surface' })
      // and it is never over the opening, however hard the drag aims at it
      expect(radius(child)).toBeGreaterThanOrEqual(inner - 0.01)
    }
  })

  it('leaves a hole piece in the hole all the way out to the edge', () => {
    const table = addObject(RING, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 }, true)!
    const maxR = Math.max(0, R_INNER() - REACH())
    for (const x of [40, 120, R_OUTER(), 400]) {
      dragLocal(child, x)
      expect(scene().objects[child].transform.elevation).toBe(0)
      expect(radius(child)).toBeLessThanOrEqual(maxR + 0.01)
    }
  })
})

describe('the solid table is unaffected', () => {
  it('allows dead centre and clamps only at the outer edge', () => {
    const table = addObject(SOLID, { x: 1000, y: 700 })
    const child = addObjectToSurface(DECOR, table, { x: 1000, y: 700 })!
    const top = scene().objects[table].size.height
    const outline = getCatalogEntry(SOLID).footprint(scene().objects[table].size).outline
    const r = outline.kind === 'circle' ? outline.r : 0

    dragLocal(child, 0)
    expect(radius(child)).toBe(0) // nothing pushes it out of a solid top

    dragLocal(child, 900)
    expect(radius(child)).toBeCloseTo(r - REACH(), 2)
    expect(scene().objects[child].transform.elevation).toBe(top)
  })
})
