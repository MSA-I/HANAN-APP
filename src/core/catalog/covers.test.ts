/**
 * The five covers that carry their own napkin (R5 PLAN-01 route 2), and the six
 * ways a cover can go wrong that nothing else in the suite would catch.
 *
 * Every assertion here is a RELATION or a rule, never a frozen measurement: the
 * sizes came off `glb-prep` and a re-export will move them, so this file asks
 * "is `defaultSize` a UNIFORM fraction of the file" rather than "is the depth
 * 32.32". The one thing it does pin is the fraction being uniform, because that
 * is the failure with no symptom — a per-axis fit squashes the round charger into
 * an ellipse in 3D while 2D goes on drawing a plausible rectangle
 * (entries/tableDecor.ts, the `decor.place-setting` note).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  addObject,
  addSeatItemsToTable,
  canReplaceObject,
  newProject,
  seatItems,
} from '../../state/actions'
import { useEditorStore } from '../../state/store'
import { strings } from '../../ui/strings'
import { overrideForPart, slotAppearances } from '../../viewer3d/appearance'
import { getCatalogEntry, listCatalog } from './registry'
import { editableSlotsOf, isEditableSlot } from './types'

/** the five new folds; the sixth cover, the napkin-less original, is `ORIGINAL` */
const FOLDS = [
  'decor.place-setting-diagonal',
  'decor.place-setting-horizontal',
  'decor.place-setting-vertical',
  'decor.place-setting-folded',
  'decor.place-setting-tied',
] as const
const ORIGINAL = 'decor.place-setting'
const COVERS = [ORIGINAL, ...FOLDS]
/** the three loose napkins — 'seat' items too, and the thing a cover is NOT */
const NAPKINS = ['decor.fabric-folded', 'decor.napkin-folded', 'decor.napkin-white']

const PLAIN_ROUND = 'table.round'
const scene = () => useEditorStore.getState().scene

describe('the five covers are place settings, catalogued like the one they join', () => {
  it.each(FOLDS)('%s is a seat-laid tableware item that stands on nothing', (id) => {
    const entry = getCatalogEntry(id)
    expect(entry.category).toBe('tableware')
    // 'seat' is what makes one drop dress every chair on the table
    expect(entry.placement).toBe('seat')
    // laid per cover, so §28's centre lock must not apply
    expect(entry.surfaceAnchor).toBe('free')
    // THE POINT OF THE FAMILY: a cover carries its own napkin, so unlike
    // `napkin()` it needs no host — and `laySeatItems` reads exactly this field to
    // decide that laying it sweeps the other covers away
    expect(entry.requiresHost).toBeUndefined()
  })

  it.each(FOLDS)('%s states the GLB it is fitted to, and points at its own file', (id) => {
    const entry = getCatalogEntry(id)
    // without `modelSize` the loader's fit ratio falls back to 1 (propModel.ts),
    // so 3D would draw the 45 cm file while 2D drew the 36 cm entry, silently
    expect(entry.modelSize).toBeDefined()
    expect(entry.model).toBe(`/props/${id.replaceAll('.', '-')}.glb`)
  })

  it.each(FOLDS)('%s shrinks its file UNIFORMLY, to within 1%%', (id) => {
    const entry = getCatalogEntry(id)
    const model = entry.modelSize!
    const size = entry.defaultSize
    const s = size.width / model.width
    // 1% of the ratio itself, which is the tolerance PLAN-01 §6 names
    expect(size.depth / model.depth).toBeCloseTo(s, 2)
    expect(size.height / model.height).toBeCloseTo(s, 2)
    expect(Math.abs(size.depth / model.depth / s - 1)).toBeLessThan(0.01)
    expect(Math.abs(size.height / model.height / s - 1)).toBeLessThan(0.01)
    // and a real reduction, the same 0.8 the original cover uses — a cover at 1.0
    // overlaps its neighbours on the ⌀180 (see that entry's pitch table)
    expect(s).toBeGreaterThan(0.5)
    expect(s).toBeLessThan(1)
  })

  it('gives all six covers the same fit ratio, so switching fold cannot resize the plate', () => {
    const ratio = (id: string) => {
      const e = getCatalogEntry(id)
      return e.defaultSize.width / e.modelSize!.width
    }
    for (const id of FOLDS) expect(ratio(id)).toBeCloseTo(ratio(ORIGINAL), 3)
  })

  it.each(FOLDS)('%s answers both the setting words and the napkin words', (id) => {
    // the item IS both, so a user hunting 'מפית' must find it and a user hunting
    // 'סכו״ם' must find it too
    const keywords = getCatalogEntry(id).keywords ?? []
    for (const word of ['סכו״ם', 'צלחת', 'ערכה', 'מפית', 'מפיות', 'קיפול']) {
      expect(keywords).toContain(word)
    }
    // and it stays findable the way its napkin-less sibling is
    for (const word of getCatalogEntry(ORIGINAL).keywords ?? []) expect(keywords).toContain(word)
  })
})

describe('the library tile', () => {
  const thumbsPrep = readFileSync(
    fileURLToPath(new URL('../../../tools/thumbs-prep.mjs', import.meta.url)),
    'utf8',
  )

  it.each(FOLDS)('%s declares the thumbnail name the prep tool writes', (id) => {
    expect(getCatalogEntry(id).thumbnail).toBe(`/thumbs/${id.replaceAll('.', '-')}.webp`)
  })

  it.each(FOLDS)('%s has a row in thumbs-prep MAPPING, or its tile is never generated', (id) => {
    // the catalog declaring a thumbnail does not make one exist; the mapping row
    // is the other half, and a fold with no row shows the vector fallback and is
    // indistinguishable from the other four in the library
    // .includes, not toContain: the haystack is a 300-line file and a failed
    // toContain prints all of it
    expect(thumbsPrep.includes(`id: '${id}'`)).toBe(true)
  })
})

describe('swapping one cover for another', () => {
  beforeEach(() => {
    newProject({ name: 'covers', venuePackId: 'resort' })
  })

  /** lay `id` on a fresh table and hand back one of the covers it laid */
  const laidCover = (id: string) => {
    newProject({ name: 'covers', venuePackId: 'resort' })
    const table = addObject(PLAIN_ROUND, { x: 1000, y: 700 })
    addSeatItemsToTable(id, table)
    const laid = seatItems(scene(), table)
    expect(laid.length).toBeGreaterThan(0)
    return laid[0]
  }

  it('is allowed between every ordered pair of the six', () => {
    // `replaceObject` keeps the cover's own transform and dressing, so this is the
    // single-cover escape hatch beside the dropdown's lay-the-whole-table. It works
    // only because all six share `placement` and `zoneKind`; the moment one of the
    // five drifts — a stray `zoneKind`, a `placement` typo — the swap silently
    // stops being offered and this is what says so.
    for (const from of COVERS) {
      const obj = laidCover(from)
      for (const to of COVERS) {
        if (to === from) continue
        expect([from, to, canReplaceObject(scene(), obj.id, to)]).toEqual([from, to, true])
      }
      // and never with itself — replacing a thing by itself is not a swap
      expect(canReplaceObject(scene(), obj.id, from)).toBe(false)
    }
  })

  it('is allowed even though every cover is an attached surface child', () => {
    // the clause that could have refused all thirty: `canReplaceObject` rejects an
    // attached object unless its attachment is a `surface` one
    const obj = laidCover(FOLDS[0])
    expect(obj.parentId).toBeTruthy()
    expect(obj.attachment?.kind).toBe('surface')
  })
})

/**
 * The napkin colour picker (PLAN-01 §3.7), and — just as deliberately — the one
 * cover that does not offer it.
 *
 * The slot only works because `tools/glb-prep/mark-napkin.mjs` renamed the napkin's
 * GLB materials `napkin-00…`. That marking is a MEASUREMENT, not a decision: the
 * tool refuses, loudly and with exit code 1, on a file where the napkin cannot be
 * told from the charger. `decor.place-setting-horizontal` is refused because Tripo
 * welded its napkin INTO the charger's primitive, and this file records the refusal
 * so that wiring it up later has to break a test rather than ship a cover that
 * repaints its own plate.
 *
 * The out-of-scope entry is therefore an ASSERTION ABOUT THE ASSET, and the way to
 * change it is to re-export that cover with the napkin segmented and re-run the
 * marker — not to add the colour here.
 */
describe('the napkin colour picker', () => {
  /** the four the marker separated, with the mean napkin texel it measured */
  const MARKED: ReadonlyArray<readonly [string, string]> = [
    ['decor.place-setting-diagonal', '#c6c2c3'],
    ['decor.place-setting-vertical', '#b9b5b2'],
    ['decor.place-setting-folded', '#797d6c'],
    ['decor.place-setting-tied', '#7d5d49'],
  ]
  const REFUSED = 'decor.place-setting-horizontal'

  it.each(MARKED)('%s offers exactly one editable slot, matching the `napkin` material', (id) => {
    const entry = getCatalogEntry(id)
    const slots = editableSlotsOf(entry)
    // ⚠ ONE. `overrideForPart` is first-match-wins, so a second slot without a
    // `match` would own the charger, the cutlery and both glasses — and it would
    // have to be listed AFTER this one even with a match.
    expect(slots).toHaveLength(1)
    expect(slots[0].slot).toBe('napkin')
    expect(slots[0].match).toBe('napkin')
    // the fabric set, which is what makes this a linen picker and not just a tint
    expect(slots[0].texture).toBe(true)
    // ABSENT ON PURPOSE (catalog/types.ts): a default weave would dress every
    // napkin the moment this shipped, instead of leaving the baked one alone
    expect(slots[0].defaultTexture).toBeUndefined()
    expect(isEditableSlot(entry, 'napkin')).toBe(true)
    // the charger's own slot is NOT editable — that is what keeps the plate baked
    expect(isEditableSlot(entry, 'body')).toBe(false)
  })

  it.each(MARKED)('%s declares the measured napkin colour on a free-picker slot', (id, colour) => {
    const slot = getCatalogEntry(id).materialSlots.find((s) => s.name === 'napkin')
    expect(slot).toBeDefined()
    expect(slot?.labelKey).toBe('napkin')
    // free picker, not the house palette: linen is matched to the day
    expect(slot?.allowCustomColor).toBe(true)
    // the tool's own measurement, so an untouched napkin looks like it did before
    expect(slot?.defaultColor).toBe(colour)
    // and the label resolves to Hebrew rather than falling back to the slot name
    expect(strings.catalog.slots.napkin).toBe('מפית')
  })

  it.each(MARKED)('%s lists `napkin` AFTER `body`, never instead of it', (id) => {
    // `body` is what the 2D footprint paints (surfaceProp's `footprint`), so losing
    // it would blank the plan shape while 3D went on looking right
    const names = getCatalogEntry(id).materialSlots.map((s) => s.name)
    expect(names[0]).toBe('body')
    expect(names).toContain('napkin')
  })

  it.each(MARKED)('%s sends the override to the napkin and to nothing else', (id) => {
    const slots = slotAppearances(getCatalogEntry(id), { napkin: { color: '#c62828' } })
    expect(slots).toEqual([{ match: 'napkin', color: '#c62828', textureId: null }])
    // every material name the marker writes
    expect(overrideForPart('napkin-00', slots)?.color).toBe('#c62828')
    expect(overrideForPart('napkin-08', slots)?.color).toBe('#c62828')
    // and everything the cover is made of besides the linen keeps its baked
    // material — undefined is the sentinel ObjectGroup turns back into the shared
    // cached one, so the plate stays woven and the cutlery stays steel
    expect(overrideForPart('Material_tripo_part_3', slots)).toBeUndefined()
    expect(overrideForPart('glass-tall', slots)).toBeUndefined()
    expect(overrideForPart('glass-short', slots)).toBeUndefined()
    expect(overrideForPart('', slots)).toBeUndefined()
  })

  it.each(MARKED)('%s asks for nothing until the user picks (the plate must not darken)', (id) => {
    // ⚠ NOT the slot's `defaultColor`. That number is the napkin's own measured
    // mean and it is ALREADY in the GLB as the material's baseColorFactor; writing
    // it onto a clone as well would multiply the file by itself.
    expect(slotAppearances(getCatalogEntry(id), {})).toEqual([
      { match: 'napkin', color: undefined, textureId: null },
    ])
  })

  it(`${REFUSED} offers no napkin slot, because its napkin is welded into the charger`, () => {
    const entry = getCatalogEntry(REFUSED)
    expect(editableSlotsOf(entry)).toHaveLength(0)
    expect(entry.materialSlots.map((s) => s.name)).toEqual(['body'])
    // and an override aimed at it reaches nothing rather than reaching everything
    expect(slotAppearances(entry, { napkin: { color: '#c62828' } })).toEqual([])
    expect(overrideForPart('Material_tripo_part_1', [])).toBeUndefined()
  })

  /**
   * ⭐ THE TEST THAT CATCHES A RE-PREP. `glb-prep` rewrites every material and
   * ERASES these names (tools/glb-prep/README.md), so a cover re-exported at a new
   * size would silently lose its picker: the catalog would still offer the control,
   * `match: 'napkin'` would find no part, and the colour would land nowhere. Nothing
   * else in the suite reads the shipped asset, so nothing else would notice.
   *
   * The GLB's material names live in its JSON chunk, which is plain text ahead of
   * any Draco payload — so this needs no glTF library, just the container header.
   */
  describe('the shipped GLB still carries the marking', () => {
    const materialNames = (id: string) => {
      const buf = readFileSync(
        fileURLToPath(new URL(`../../../public/props/${id.replaceAll('.', '-')}.glb`, import.meta.url)),
      )
      expect(buf.toString('utf8', 0, 4)).toBe('glTF')
      // 12-byte container header, then chunks of [length u32, type u32, data]
      const chunkLength = buf.readUInt32LE(12)
      expect(buf.readUInt32LE(16)).toBe(0x4e4f534a) // 'JSON'
      const json = JSON.parse(buf.toString('utf8', 20, 20 + chunkLength)) as {
        materials?: { name?: string }[]
      }
      return (json.materials ?? []).map((m) => m.name ?? '')
    }

    it.each(MARKED)('%s has at least one material named `napkin…`', (id) => {
      const names = materialNames(id)
      const marked = names.filter((n) => n.startsWith('napkin'))
      expect(marked.length).toBeGreaterThan(0)
      // UNIQUE names, shared prefix — propModel merges primitives that share a
      // material name and keeps only the FIRST material, which would dress the tied
      // cover's nine napkin parts in part 0's maps over eight other UV layouts
      expect(new Set(marked).size).toBe(marked.length)
      // and the catalogue's `match` is a prefix of every one of them
      const slot = editableSlotsOf(getCatalogEntry(id))[0]
      for (const name of marked) expect(name.startsWith(slot.match!)).toBe(true)
    })

    it(`${REFUSED} carries no marking, matching its empty slot list`, () => {
      expect(materialNames(REFUSED).filter((n) => n.startsWith('napkin'))).toEqual([])
    })

    it('the tied cover carries all nine parts of its napkin, knot included', () => {
      // the one file where the linen is more than one primitive; nine is what the
      // marker measured, and eight was the count before its lift threshold was
      // lowered to reach the 353-triangle knot fragment
      expect(materialNames('decor.place-setting-tied').filter((n) => n.startsWith('napkin'))).toHaveLength(9)
    })
  })
})

describe('the `סוג הערכה` dropdown (InspectorPanel.seatItemEntries)', () => {
  /** the filter the inspector applies, kept here so the rule is tested and not the JSX */
  const seatItemEntries = () =>
    listCatalog().filter((entry) => entry.placement === 'seat' && !entry.requiresHost)

  it('offers exactly the six covers', () => {
    expect(seatItemEntries().map((e) => e.id).sort()).toEqual([...COVERS].sort())
  })

  it('offers no napkin — a napkin is not a kind of cover, and laying one refuses', () => {
    // the bug this filter fixes: `placement === 'seat'` alone put the three
    // napkins in the dropdown, and picking one made the button next to it refuse
    // with `missingHost` every single time (PLAN-01 §2.6)
    const offered = seatItemEntries().map((e) => e.id)
    for (const napkin of NAPKINS) expect(offered).not.toContain(napkin)
    // the napkins are still 'seat' items, so the filter is doing real work
    expect(listCatalog().filter((e) => e.placement === 'seat')).toHaveLength(
      seatItemEntries().length + NAPKINS.length,
    )
  })
})
