/**
 * The acrylic guest chair (PLAN-04). Four of the things below can break in
 * complete silence, and each has its own assertion:
 *
 *  - `defaultSize` taken from a bounding box the chair does not fill. The chair
 *    sits in its file at −153.08°, and the box AROUND that rotated box is
 *    83.0 × 83.4 for a chair that is 46.35 × 53.90 — a footprint 53 % too large,
 *    every centimetre of which the engine then demands as clearance from every
 *    neighbour. `glb-prep` printed exactly that number until 2026-08-02.
 *  - the model sitting OFF CENTRE inside its own file, which is the same mistake
 *    one step later: a box's centre survives a rotation, the geometry inside it
 *    does not. It shipped 2.28 cm back and 0.23 cm left of centre, so the 3D chair
 *    stood behind the rectangle the 2D plan drew for it, and nothing failed.
 *  - the material marking erased by a re-run of `glb-prep` (README:71). The chair
 *    then renders as dark rough metal and nothing fails.
 *  - the entry landing in `seating`, where it would offer itself as the chair
 *    model for a table standing anywhere in the hall.
 *
 * ⚠ WHY THE FILE IS READ AS RAW GLB AND NOT THROUGH gltf-transform. The mesh is
 * Draco-compressed, so the vertices need the decoder — which lives in
 * `tools/glb-prep/node_modules` as an asset-prep dependency and is deliberately
 * not an app dependency. What the container's JSON chunk gives without any
 * decoder is still most of the story: the material names, the accessor's own
 * min/max, the prep scale and the prep yaw. Height and yaw are therefore derived
 * from the shipped file exactly; width and depth are the numbers measured with
 * gltf-transform on 2026-08-02, reproducible with
 *
 *     node tools/glb-prep/inspect-materials.mjs public/props/chair-chuppah-guest.glb
 *
 * and pinned here against the specific failure above.
 */
import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getCatalogEntry, listByCategory, CATEGORY_ORDER } from './registry'
import { chairChuppahGuest } from './entries/chuppahChair'
import { getVenuePack } from '../venuePacks'
import { strings } from '../../ui/strings'

const GLB = 'public/props/chair-chuppah-guest.glb'

/** The container's JSON chunk — no decoder, no dependency. */
function glbJson(path: string): {
  materials: { name: string }[]
  nodes: { name?: string; scale?: number[]; rotation?: number[] }[]
  accessors: { min?: number[]; max?: number[] }[]
} {
  const buf = readFileSync(path)
  const jsonLength = buf.readUInt32LE(12)
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'))
}

const file = glbJson(GLB)
const nodeNamed = (name: string) => file.nodes.find((n) => n.name === name)!
const manifest = JSON.parse(readFileSync('public/plan/manifest.json', 'utf8')) as {
  items: Record<string, { cmW: number; cmD: number }>
}
/** cm per model unit, from `prep_scale` — glb-prep writes cm→m as a node scale. */
const SCALE_CM = nodeNamed('prep_scale').scale![0] * 100
const box = file.accessors.find((a) => a.min && a.max)!

describe('the shipped GLB', () => {
  it('exists, and is a fraction of the 20.4 MB source', () => {
    expect(existsSync(GLB)).toBe(true)
    const bytes = readFileSync(GLB).byteLength
    // the largest prop in the folder is dj-resort.glb at 1.63 MB; 17 of the
    // source's 20.4 MB were textures this entry's material throws away anyway
    expect(bytes).toBeLessThan(1_600_000)
  })

  it('⭐ still carries the `acrylic` marking a re-prep would have erased', () => {
    expect(file.materials).toHaveLength(1)
    expect(file.materials[0].name).toBe('acrylic-00')
    for (const m of file.materials) expect(m.name.startsWith('acrylic')).toBe(true)
  })

  it('was yawed to −153.08°, which is what puts the backrest at +Z', () => {
    const q = nodeNamed('prep_root').rotation!
    const deg = (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI
    expect(deg).toBeCloseTo(-153.08, 1)
  })

  it("publishes the file's own HEIGHT, which no yaw about Y can distort", () => {
    const heightCm = (box.max![1] - box.min![1]) * SCALE_CM
    expect(heightCm).toBeCloseTo(chairChuppahGuest.defaultSize.height, 2)
    expect(heightCm).toBeCloseTo(97.94, 2)
  })

  /**
   * The trap itself. The raw file's box is 61.50 × 62.31 and the yaw turns THAT
   * box into 83.0 × 83.4 — the number a hurried reading would have catalogued,
   * and the number glb-prep itself printed until its bounds were fixed to walk the
   * vertices. The published footprint has to be well under both, because the chair
   * inside the box is neither.
   */
  it('is NOT catalogued from the rotated bounding box', () => {
    const rawW = (box.max![0] - box.min![0]) * SCALE_CM
    const rawD = (box.max![2] - box.min![2]) * SCALE_CM
    expect(rawW).toBeCloseTo(61.5, 1)
    expect(rawD).toBeCloseTo(62.31, 1)
    const yaw = (2 * Math.atan2(nodeNamed('prep_root').rotation![1], nodeNamed('prep_root').rotation![3]))
    const inflatedW = Math.abs(rawW * Math.cos(yaw)) + Math.abs(rawD * Math.sin(yaw))
    expect(inflatedW).toBeCloseTo(83.0, 0)
    // measured on the vertices (see the header): 46.35 × 53.90
    expect(chairChuppahGuest.defaultSize.width).toBeCloseTo(46.35, 2)
    expect(chairChuppahGuest.defaultSize.depth).toBeCloseTo(53.9, 2)
    expect(chairChuppahGuest.defaultSize.width).toBeLessThan(inflatedW * 0.6)
  })

  /**
   * ⭐ THE CHAIR IS CENTRED IN ITS OWN FILE — asserted through the plan image,
   * because that is where it is both provable without a Draco decoder and where
   * being off centre actually hurt.
   *
   * `tools/topdown-prep.mjs` frames every prop symmetrically about the MODEL
   * ORIGIN and not about its bounding box (:185-201, deliberately: the origin is
   * what ObjectNode positions and rotates around), then pads by `PAD` (:46). So
   * the manifest's span is `(size + 2·|offset|) × (1 + PAD)` and the offset falls
   * straight out of it. Off centre by 2.28 cm in Z, the chair published a 59.63 cm
   * plan image for a 53.90 cm chair, and the 3D model stood 2.28 cm behind the
   * rectangle the 2D editor drew — a disagreement no test could see and no error
   * could report.
   *
   * The bound is 0.5 mm. What shipped was 22.8 mm and 2.3 mm.
   */
  it('⭐ is centred in its own file, and the plan image is where that shows', () => {
    const PAD = 1.02
    const item = manifest.items['/props/chair-chuppah-guest.glb']
    expect(item).toBeTruthy()
    const offsetX = (item.cmW / PAD - chairChuppahGuest.defaultSize.width) / 2
    const offsetZ = (item.cmD / PAD - chairChuppahGuest.defaultSize.depth) / 2
    expect(Math.abs(offsetX)).toBeLessThan(0.05)
    expect(Math.abs(offsetZ)).toBeLessThan(0.05)
  })

  it('points at files that are actually there', () => {
    expect(chairChuppahGuest.model).toBe('/props/chair-chuppah-guest.glb')
    expect(existsSync(`public${chairChuppahGuest.model}`)).toBe(true)
    expect(existsSync(`public${chairChuppahGuest.thumbnail}`)).toBe(true)
  })
})

describe('the entry', () => {
  it('is registered and reachable by id', () => {
    expect(getCatalogEntry('chair.chuppah-guest')).toBe(chairChuppahGuest)
  })

  /**
   * `allowedZones` is a two-sided rule: a named zone stops refusing the entry
   * (collision.ts:879) AND `bandViolations` (:740-747) refuses it everywhere else.
   * A typo does not degrade to "allowed anywhere" — it makes the chair `wrongZone`
   * in the whole venue, which is why the kinds are checked against the pack.
   */
  it('names exactly the dance floor and the reception deck, and both exist', () => {
    expect(chairChuppahGuest.allowedZones).toEqual([
      { kind: 'dancefloor', within: 0 },
      { kind: 'kabalatPanim', within: 0 },
    ])
    const kinds = new Set(getVenuePack('resort')!.restricted!.map((z) => z.kind))
    for (const rule of chairChuppahGuest.allowedZones!) expect(kinds.has(rule.kind)).toBe(true)
  })

  it('stays OUT of the three table "chair model" dropdowns', () => {
    const seating = listByCategory('seating')
    expect(seating.map((e) => e.id)).not.toContain('chair.chuppah-guest')
    expect(seating).toHaveLength(6)
    expect(listByCategory('chuppahChair').map((e) => e.id)).toEqual(['chair.chuppah-guest'])
  })

  it('has a place in the library order and a label in both dictionaries', () => {
    expect(CATEGORY_ORDER.filter((c) => c === 'chuppahChair')).toHaveLength(1)
    expect(strings.catalog.categories.chuppahChair).toBeTruthy()
    expect(strings.catalog.items[chairChuppahGuest.labelKey as 'chairChuppahGuest']).toBeTruthy()
    expect(strings.catalog.slots.body).toBeTruthy()
  })

  it('carries ONE material slot and no editable one', () => {
    expect(chairChuppahGuest.materialSlots).toHaveLength(1)
    expect(chairChuppahGuest.materialSlots[0].name).toBe('body')
    expect(chairChuppahGuest.editableSlots).toBeUndefined()
  })

  /**
   * The user's decision of 2026-08-02: one chair, not a set. `unique` is what
   * `uniqueBlocker` reads, and — since PLAN-07 — what the three copy routes read
   * as well, so Ctrl+D cannot produce a second one either.
   */
  it('is unique, under a tag of its own and not the canopy’s', () => {
    expect(chairChuppahGuest.unique).toBe('chuppahGuestChair')
    expect(getCatalogEntry('chuppah.draped-white').unique).toBe('chuppah')
  })

  it('carries no `zoneKind`, so it is a permission and not a home', () => {
    expect(chairChuppahGuest.zoneKind).toBeUndefined()
    expect(chairChuppahGuest.seating).toBeUndefined()
    expect(chairChuppahGuest.placement).not.toBe('ceiling')
  })
})
