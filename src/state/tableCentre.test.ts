/**
 * Source doc §54b — "table designs go in the MIDDLE of the table; I also meant the
 * middle of a table where there is no place setting and no big round hole."
 *
 * The middle is not one rule but three, and they were already in the code
 * separately (`clampToSurface`'s `surfaceAnchor: 'center'` branch, and the hole
 * split PLAN-06 pinned in ringHole.test.ts). What §54b asks is whether the middle
 * a piece is sent to is FREE once the table is fully dressed. That is the question
 * this file answers, on a table wearing a complete set of covers rather than on a
 * bare one:
 *
 *   solid top → the geometric centre, and the covers really are out at the rim
 *   ring top  → the opening, so it stands on the floor and rises through it
 *
 * ringHole.test.ts already covers the two placements on a BARE table. Nothing here
 * repeats it; what is added is the set of covers, which is what makes "free" mean
 * anything.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry, listCatalog } from '../core/catalog/registry'
import { holeRadius } from '../core/layout/bounds'
import { serpentineBandDepth, serpentineCentre } from '../core/layout/serpentine'
import { TABLE_DESIGNS } from '../core/presets'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  applyTableDesign,
  designItems,
  newProject,
  seatItems,
  surfaceCentre,
} from './actions'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

const SOLID = 'table.round'
const RING = 'table.round-large'
const COVER = 'decor.place-setting'
const PIECE = 'decor.candelabra-crystal'

const outlineOf = (catalogId: string) => {
  const e = getCatalogEntry(catalogId)
  return e.footprint(e.defaultSize).outline
}
/** How far an entry's own footprint reaches from its centre, worst case. */
const reachOf = (catalogId: string) => {
  const o = outlineOf(catalogId)
  return o.kind === 'circle' ? o.r : Math.hypot(o.w, o.h) / 2
}

/** Drop a table, lay a full set of covers, then hand-place one centrepiece. */
function dressed(tableId: string) {
  const table = addObject(tableId, { x: 1200, y: 800 })
  const covers = addSeatItemsToTable(COVER, table)
  // dropped well off-centre, out on the rim — §28 is what pulls it in
  const o = outlineOf(tableId)
  const edge = o.kind === 'circle' ? o.r : Math.min(o.w, o.h) / 2
  const piece = addObjectToSurface(PIECE, table, { x: 1200 + edge - reachOf(PIECE) - 1, y: 800 })!
  return { table, covers, piece }
}

beforeEach(() => {
  newProject({ name: 'centre', venuePackId: 'resort' })
})

describe('a hand-placed centrepiece finds the free middle of a dressed table', () => {
  it('sits on the top of a solid table, inside the ring of covers', () => {
    const { table, covers, piece } = dressed(SOLID)
    expect(covers.length).toBe(getCatalogEntry(SOLID).seating!.defaultCount)

    const obj = scene().objects[piece]
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.transform.elevation).toBe(scene().objects[table].size.height)
    expect(obj.attachment).toEqual({ kind: 'surface' })

    // …and the middle it was sent to is genuinely empty: every cover is further
    // out than the piece reaches, so "the centre" is not a place already taken
    const cover = getCatalogEntry(COVER).defaultSize
    const clearance = Math.hypot(cover.width, cover.depth) / 2 + reachOf(PIECE)
    for (const c of seatItems(scene(), table)) {
      const r = Math.hypot(c.transform.position.x, c.transform.position.y)
      expect(r).toBeGreaterThan(clearance)
    }
  })

  it('stands through the opening of a ring table, and the covers still clear it', () => {
    const { table, covers, piece } = dressed(RING)
    expect(covers.length).toBe(getCatalogEntry(RING).seating!.defaultCount)

    const obj = scene().objects[piece]
    // the middle of THIS table is the hole, so the piece is on the FLOOR
    expect(obj.transform.position).toEqual({ x: 0, y: 0 })
    expect(obj.transform.elevation).toBe(0)
    expect(obj.attachment).toEqual({ kind: 'surface', inHole: true })

    // the covers are laid on the annulus, not over the well — this is §43's
    // assertion arriving through the real drop path rather than the pure function
    const hole = holeRadius(outlineOf(RING))
    const cover = getCatalogEntry(COVER).defaultSize
    for (const c of seatItems(scene(), table)) {
      const r = Math.hypot(c.transform.position.x, c.transform.position.y)
      expect(r - Math.hypot(cover.width, cover.depth) / 2).toBeGreaterThan(hole)
      expect(c.transform.elevation).toBe(scene().objects[table].size.height)
    }
  })
})

/**
 * Source doc §53. The serpentine's bounding box has a centre; the serpentine does
 * not have one there. Everything below is the difference that makes.
 */
describe('the serpentine, whose middle is not its origin', () => {
  const SNAKE = 'table.serpentine'

  /**
   * The safety rail the whole change rests on. `surfaceCentre` is consulted on
   * EVERY centred drop and EVERY design lay, so if it returned anything but a
   * literal origin for an ordinary table it would move furniture on tables nobody
   * asked about. Swept over the real catalog rather than over a list someone
   * remembered to update.
   */
  it('leaves every other entry in the catalog at exactly (0,0)', () => {
    const others = listCatalog().filter((e) => e.id !== SNAKE)
    expect(others.length).toBeGreaterThan(50) // the sweep is not vacuous
    for (const entry of others) expect(surfaceCentre(entry)).toEqual({ x: 0, y: 0 })
    // and the one exception really is the exception
    expect(surfaceCentre(getCatalogEntry(SNAKE))).toEqual(serpentineCentre())
    expect(surfaceCentre(getCatalogEntry(SNAKE))).not.toEqual({ x: 0, y: 0 })
  })

  it('lands a hand-placed centrepiece on the band instead of over the floor', () => {
    const table = addObject(SNAKE, { x: 1200, y: 800 })
    const piece = addObjectToSurface(PIECE, table, { x: 1200, y: 800 })!
    const obj = scene().objects[piece]

    expect(obj.transform.position).toEqual(serpentineCentre())
    expect(serpentineBandDepth(obj.transform.position)).toBeGreaterThan(0)
    expect(obj.transform.elevation).toBe(scene().objects[table].size.height)
    // no hole on this table, so it stands on the top rather than dropping through
    expect(obj.attachment).toEqual({ kind: 'surface' })
  })

  it('carries every built-in design onto the band', () => {
    const table = addObject(SNAKE, { x: 1200, y: 800 })
    const mid = serpentineCentre()

    for (const design of TABLE_DESIGNS) {
      applyTableDesign(design.id, table)
      const laid = designItems(scene(), table).filter(
        (o) => getCatalogEntry(o.catalogId).placement !== 'seat',
      )
      expect(laid).toHaveLength(design.items.length)
      for (const o of laid) {
        // every piece is on the table, and its authored offset is preserved
        expect(serpentineBandDepth(o.transform.position)).toBeGreaterThan(0)
        const dx = o.transform.position.x - mid.x
        const dy = o.transform.position.y - mid.y
        const authored = design.items.find((i) => i.catalogId === o.catalogId && (i.x ?? 0) === Math.round(dx))
        expect(authored).toBeDefined()
        expect(dy).toBeCloseTo(0, 6)
      }
    }
  })

  /**
   * The residual, recorded rather than hidden. The offsets are NOT re-spaced along
   * the curve — a design is an arrangement, and re-spacing four authored designs
   * makes four different ones. So three of the twelve built-in pieces hang over the
   * drape edge, by less than the ±5 cm the model's own band width wanders.
   */
  it('overhangs the drape edge on exactly three of the twelve built-in pieces', () => {
    const mid = serpentineCentre()
    const over: number[] = []
    for (const design of TABLE_DESIGNS) {
      for (const item of design.items) {
        const e = getCatalogEntry(item.catalogId)
        const o = e.footprint(e.defaultSize).outline
        const reach = o.kind === 'circle' ? o.r : Math.hypot(o.w, o.h) / 2
        const depth = serpentineBandDepth({ x: mid.x + (item.x ?? 0), y: mid.y + (item.y ?? 0) })
        expect(depth).toBeGreaterThan(0) // the CENTRE is always on the table
        if (depth < reach) over.push(reach - depth)
      }
    }
    expect(over).toHaveLength(3)
    expect(Math.max(...over)).toBeCloseTo(3.71, 1)
    expect(Math.max(...over)).toBeLessThan(5) // inside the band's own 75…85 wander
  })
})
