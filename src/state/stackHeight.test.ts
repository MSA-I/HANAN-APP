/**
 * What a rider stands ON (source doc §12, §45b, §46b).
 *
 * Two riders, one rule. Both used to be laid at `parent.size.height +
 * host.size.height`, and that formula is wrong twice over:
 *
 *   napkin on a place setting — the setting's catalogued height is its WINE
 *     GLASS, so the napkin was laid at glass-rim height. That is the whole
 *     "napkins are floating in the air" report.
 *   ring.floral on ring.table — the small table stands on the FLOOR through the
 *     ⌀380's opening, so its own elevation is 0. Adding the ⌀380's height to its
 *     height put the urn a table-height too high.
 *
 * Nothing here hardcodes a measurement: the setting's stacking surface is read
 * back through `stackHeight`, which is the accessor standing in for the catalog
 * field this belongs in, and every other number comes from the catalog or the
 * scene (BRIEF §1.7). The assertions are RELATIONS — "on the charger, not on the
 * glass" — so they keep meaning if the model is ever re-measured.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { holeRadius } from '../core/layout/bounds'
import type { SceneObject } from '../core/model/types'
import { relativeTransform } from '../core/space'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  newProject,
  seatItems,
  setPosition,
  setRotation,
  stackHeight,
  stackedPosition,
} from './actions'
import { surfaceChildren } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

const SETTING = 'decor.place-setting'
const NAPKINS = ['decor.fabric-folded', 'decor.napkin-folded', 'decor.napkin-white']
const ROLLED = 'decor.napkin-folded'
const RING_TABLE = 'ring.table'
const RING_FLORAL = 'ring.floral'
const BIG_ROUND = 'table.round-large'
const PLAIN_ROUND = 'table.round'

const obj = (id: string) => scene().objects[id]
const childrenOfKind = (tableId: string, catalogId: string) =>
  surfaceChildren(scene(), tableId).filter((c) => c.catalogId === catalogId)

beforeEach(() => {
  newProject({ name: 'stack', venuePackId: 'resort' })
})

describe('stackHeight — the surface a rider may stand on', () => {
  it('is the place setting CHARGER, well below its catalogued wine-glass height', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(SETTING, table)
    const setting = seatItems(scene(), table)[0]
    expect(setting).toBeDefined()

    const total = setting.size.height
    const surface = stackHeight(setting)
    // the fix in one line: the stacking surface is NOT the item's full height
    expect(surface).toBeLessThan(total)
    // and it is a plate, not a glass — under half the cover's height, above zero
    expect(surface).toBeGreaterThan(0)
    expect(surface).toBeLessThan(total / 2)
  })

  it('falls back to the full height for anything flat', () => {
    const table = addObject(BIG_ROUND, { x: 1000, y: 700 })
    const centre = obj(table).transform.position
    const ring = addObjectToSurface(RING_TABLE, table, { ...centre })!
    // no entry in the table -> the whole item is its own stacking surface, which
    // is right for a table top and for the ring table's cloth
    expect(stackHeight(obj(ring))).toBe(obj(ring).size.height)
    expect(stackHeight(obj(table))).toBe(obj(table).size.height)
  })

  it('rides a resized host rather than staying at the catalogued number', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(SETTING, table)
    const id = seatItems(scene(), table)[0].id
    const before = stackHeight(obj(id))
    const entry = getCatalogEntry(SETTING)
    useEditorStore.setState((s) => {
      s.scene.objects[id].size.height = entry.defaultSize.height * 2
    })
    // the loader fits the whole model to `size`, so the plate goes up with it
    expect(stackHeight(obj(id))).toBeCloseTo(before * 2, 6)
  })
})

describe('§12 + §45b — a napkin is laid on the charger, not on the wine glass', () => {
  for (const napkinId of NAPKINS) {
    it(`lays ${napkinId} on the setting's stacking surface`, () => {
      const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
      addSeatItemsToTable(SETTING, table)
      addSeatItemsToTable(napkinId, table)

      const settings = childrenOfKind(table, SETTING)
      const napkins = childrenOfKind(table, napkinId)
      expect(napkins).toHaveLength(settings.length)
      expect(napkins.length).toBeGreaterThan(0)

      const top = obj(table).size.height
      for (const napkin of napkins) {
        const hostId = napkin.attachment?.kind === 'surface' ? napkin.attachment.stackedOn : undefined
        const host = hostId ? obj(hostId) : undefined
        expect(host?.catalogId).toBe(SETTING)

        expect(napkin.transform.elevation).toBeCloseTo(top + stackHeight(host!), 6)
        // THE REGRESSION: the old formula was `table + host.size.height`, i.e. the
        // rim of the wine glass. Every napkin hung in the air above the cover.
        expect(napkin.transform.elevation).toBeLessThan(top + host!.size.height)
      }
    })
  }

  it('leaves the napkin below the wine glass instead of on top of it', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(SETTING, table)
    addSeatItemsToTable(NAPKINS[0], table)
    const top = obj(table).size.height
    const setting = childrenOfKind(table, SETTING)[0]
    const napkin = childrenOfKind(table, NAPKINS[0])[0]
    // all three napkins are shorter than the gap between charger and glass rim,
    // so a napkin laid on the plate is contained by the cover it dresses
    expect(napkin.transform.elevation + napkin.size.height).toBeLessThanOrEqual(
      top + setting.size.height,
    )
  })

  it('reaches the same height again when the napkin is re-clamped', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(SETTING, table)
    addSeatItemsToTable(NAPKINS[0], table)
    const napkin = childrenOfKind(table, NAPKINS[0])[0]
    const laid = napkin.transform.elevation

    // dragging a stacked rider re-runs clampToSurface, which is the SECOND site
    // that computes this height. One helper feeds both, so they cannot drift.
    setPosition(napkin.id, { x: 400, y: 400 })
    expect(obj(napkin.id).transform.elevation).toBeCloseTo(laid, 6)
  })
})

/**
 * §13 — the other half of the same defect. `clampToSurface` copied the host's
 * position outright, so a napkin was pinned to the MIDDLE of the cover; the plate
 * is not there, and the middle of a cover is where the cutlery meets the plate.
 *
 * Nothing below freezes the offset. Every assertion is a relation — "not the
 * host's own point", "the same point both writers produce", "inside the cover at
 * every rotation" — so a re-measure of the model keeps them meaningful (BRIEF §1.7).
 */
describe('§13 — a napkin is laid on the PLATE, not on the middle of the cover', () => {
  const hostOf = (rider: SceneObject) =>
    obj(rider.attachment?.kind === 'surface' ? rider.attachment.stackedOn! : '')
  const laidPair = (tableId: string, napkinId = ROLLED) => {
    addSeatItemsToTable(SETTING, tableId)
    addSeatItemsToTable(napkinId, tableId)
    const napkin = childrenOfKind(tableId, napkinId)[0]
    return { napkin, host: hostOf(napkin) }
  }

  it('lands off the cover\'s own point, on the offset the helper declares', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const { napkin, host } = laidPair(table)
    // THE REGRESSION: `child.position = { ...host.position }` — dead centre of the
    // cover, which is not where its plate is
    expect(napkin.transform.position).not.toEqual(host.transform.position)
    expect(napkin.transform.position).toEqual(stackedPosition(host))
  })

  it('returns to the same point when the napkin is re-clamped', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const { napkin } = laidPair(table)
    const laid = { ...napkin.transform.position }

    // the position twin of the height test above: `laySeatItems` and
    // `clampToSurface` are two independent writers of this value, and nothing
    // re-clamps a surface child automatically — so a drag has to land back on the
    // plate rather than on the cover's origin
    setPosition(napkin.id, { x: 400, y: 400 })
    expect(obj(napkin.id).transform.position.x).toBeCloseTo(laid.x, 6)
    expect(obj(napkin.id).transform.position.y).toBeCloseTo(laid.y, 6)
  })

  it('offsets in the COVER\'s frame, so every cover round the table gets its own plate', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(SETTING, table)
    addSeatItemsToTable(ROLLED, table)
    const napkins = childrenOfKind(table, ROLLED)
    expect(napkins.length).toBeGreaterThan(3)

    // a ring of covers faces every way, so a WORLD-axis offset would put the
    // napkin on a different part of the cover on each side of the table. In the
    // cover's own frame the offset must be one and the same vector.
    const first = relativeTransform(hostOf(napkins[0]).transform, napkins[0].transform).position
    const rotations = new Set<number>()
    for (const napkin of napkins) {
      const host = hostOf(napkin)
      rotations.add(host.transform.rotation)
      const local = relativeTransform(host.transform, napkin.transform).position
      expect(local.x).toBeCloseTo(first.x, 6)
      expect(local.y).toBeCloseTo(first.y, 6)
    }
    // the guard on the guard: if every cover faced the same way the check above
    // would pass for a world-axis offset too
    expect(rotations.size).toBeGreaterThan(1)
    expect(Math.hypot(first.x, first.y)).toBeGreaterThan(0)
  })

  it('fits inside the cover it dresses at EVERY rotation', () => {
    // "it fits the plate" as a property of the catalog rather than a frozen
    // number: the plate lives inside the cover, so a napkin whose CIRCUMcircle —
    // the circle its corners sweep as it turns — clears the cover's own rectangle
    // is a napkin that can never hang off the setting, whichever way it is laid.
    const cover = getCatalogEntry(SETTING).defaultSize
    const napkin = getCatalogEntry(ROLLED).defaultSize
    const r = Math.hypot(napkin.width, napkin.depth) / 2

    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const { napkin: laid, host } = laidPair(table)
    const off = relativeTransform(host.transform, laid.transform).position

    expect(Math.abs(off.x) + r).toBeLessThanOrEqual(cover.width / 2)
    expect(Math.abs(off.y) + r).toBeLessThanOrEqual(cover.depth / 2)
    // and it really is a reduction: the file the loader fits is bigger than the
    // circle, which is what the v11 → v12 migration exists to correct
    expect(2 * r).toBeLessThan(getCatalogEntry(ROLLED).modelSize!.depth)
  })

  it('keeps a rotation the user gave the napkin', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const { napkin, host } = laidPair(table)
    // laid facing its guest, like the cover it dresses
    expect(napkin.transform.rotation).toBe(host.transform.rotation)

    setRotation(napkin.id, host.transform.rotation + 37)
    // THE REGRESSION: `child.rotation = host.rotation` ran on every clamp, so a
    // turned napkin snapped back the instant anything re-clamped it
    setPosition(napkin.id, { x: 400, y: 400 })
    expect(obj(napkin.id).transform.rotation).toBe(host.transform.rotation + 37)
  })

  it('still rides its cover — the pin was kept, only the point moved', () => {
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    const { napkin, host } = laidPair(table)
    const before = relativeTransform(host.transform, napkin.transform).position

    // the plan's highest-rated risk: adding an offset must not cost the pinning
    // that keeps a napkin on its cover when the table is dragged
    setPosition(table, { x: 1400, y: 900 })
    const movedHost = obj(host.id)
    const after = relativeTransform(movedHost.transform, obj(napkin.id).transform).position
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('leaves the two napkins with no declared offset on their host\'s own point', () => {
    // `ring.floral` on `ring.table` is the case the map must not disturb: a disc
    // centred on a disc, with no entry, still lands exactly on its host
    const table = addObject(BIG_ROUND, { x: 1000, y: 700 })
    const centre = { ...obj(table).transform.position }
    const ring = addObjectToSurface(RING_TABLE, table, centre)!
    const floral = addObjectToSurface(RING_FLORAL, table, centre)!
    expect(stackedPosition(obj(ring))).toEqual(obj(ring).transform.position)
    expect(obj(floral).transform.position).toEqual(obj(ring).transform.position)
  })
})

describe('§46b — the urn stands on the small table inside the ⌀380 opening', () => {
  it('takes the ring table as its host and its height from the floor', () => {
    const table = addObject(BIG_ROUND, { x: 1000, y: 700 })
    // the opening is what makes this case different from every other stack
    const entry = getCatalogEntry(BIG_ROUND)
    expect(holeRadius(entry.footprint(entry.defaultSize).outline)).toBeGreaterThan(0)

    const centre = { ...obj(table).transform.position }
    const ring = addObjectToSurface(RING_TABLE, table, centre)!
    const floral = addObjectToSurface(RING_FLORAL, table, centre)!

    // the small table drops through the hole and stands on the floor
    expect(obj(ring).transform.elevation).toBe(0)
    expect(obj(ring).attachment).toEqual({ kind: 'surface', inHole: true })

    // the urn is linked to it and stands on ITS top, not on the ⌀380's
    const attachment = obj(floral).attachment
    expect(attachment?.kind === 'surface' && attachment.stackedOn).toBe(ring)
    expect(obj(floral).transform.elevation).toBeCloseTo(stackHeight(obj(ring)), 6)
    expect(obj(floral).transform.position).toEqual(obj(ring).transform.position)

    // THE REGRESSION: `parent.size.height + host.size.height` put it a whole
    // table-height above the piece it is meant to be standing on
    expect(obj(floral).transform.elevation).toBeLessThan(
      obj(table).size.height + obj(ring).size.height,
    )
  })

  it('keeps the urn on the ring table when it is dragged', () => {
    const table = addObject(BIG_ROUND, { x: 1000, y: 700 })
    const centre = { ...obj(table).transform.position }
    const ring = addObjectToSurface(RING_TABLE, table, centre)!
    const floral = addObjectToSurface(RING_FLORAL, table, centre)!
    const laid = obj(floral).transform.elevation

    setPosition(floral, { x: 150, y: 90 })
    expect(obj(floral).transform.elevation).toBeCloseTo(laid, 6)
    expect(obj(floral).transform.position).toEqual(obj(ring).transform.position)
  })
})
