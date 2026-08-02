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
import { execFileSync } from 'node:child_process'
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

/**
 * THE SHIPPED FILES, read out of the GLB container's own JSON chunk.
 *
 * Decoder-free on purpose — the same trick, and the same reason, as
 * chuppahChair.test.ts:15-26: the meshes are Draco-compressed and the decoder
 * lives in `tools/glb-prep/node_modules` as an asset-prep dependency that is
 * deliberately not an app dependency. Material names and every POSITION
 * accessor's own min/max are in the JSON, which is all these assertions need.
 *
 * What they catch is the whole class of "the asset moved and the catalog did
 * not", which has no symptom at runtime: a `modelSize` that no longer matches
 * its file makes `propModel` fit the model by the wrong ratio, so 3D draws one
 * size while 2D draws another, and a marking erased by a re-run of `glb-prep`
 * (README:71) just renders glass as opaque plastic.
 */
type Glb = {
  materials: { name: string }[]
  meshes: { primitives: { material: number; attributes: { POSITION: number } }[] }[]
  accessors: { min?: number[]; max?: number[] }[]
  nodes: { name?: string; scale?: number[]; rotation?: number[]; translation?: number[] }[]
}
type Box = { x: [number, number]; y: [number, number]; z: [number, number] }

const glbPath = (id: string) => `public/props/${id.replaceAll('.', '-')}.glb`

function glbJson(path: string): Glb {
  const buf = readFileSync(path)
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'))
}

/**
 * cm per model unit and the prep yaw, from the nodes `glb-prep` writes. The box
 * maths below turns a raw accessor box into a world one by hand, which is only
 * valid for a HALF turn (x→−x, z→−z, sizes untouched) with nothing translated —
 * both of which every test here asserts before relying on them.
 */
function prep(file: Glb) {
  const node = (name: string) => file.nodes.find((n) => n.name === name)!
  const q = node('prep_root').rotation!
  return {
    scaleCm: node('prep_scale').scale![0] * 100,
    yawDeg: (2 * Math.atan2(q[1], q[3]) * 180) / Math.PI,
    translated: ['prep_rot', 'prep_scale', 'prep_root'].filter((n) => node(n).translation),
  }
}

/** every material's world box in cm, keyed by material name */
function materialBoxes(file: Glb, scaleCm: number): Map<string, Box> {
  const out = new Map<string, Box>()
  for (const mesh of file.meshes) {
    for (const primitive of mesh.primitives) {
      const a = file.accessors[primitive.attributes.POSITION]
      const name = file.materials[primitive.material].name
      const lo = [-a.max![0] * scaleCm, a.min![1] * scaleCm, -a.max![2] * scaleCm]
      const hi = [-a.min![0] * scaleCm, a.max![1] * scaleCm, -a.min![2] * scaleCm]
      const box = out.get(name)
      if (!box) out.set(name, { x: [lo[0], hi[0]], y: [lo[1], hi[1]], z: [lo[2], hi[2]] })
      else {
        for (const [axis, i] of [['x', 0], ['y', 1], ['z', 2]] as const) {
          box[axis][0] = Math.min(box[axis][0], lo[i])
          box[axis][1] = Math.max(box[axis][1], hi[i])
        }
      }
    }
  }
  return out
}

/** the model's own outer box in cm, as {width, depth, height} */
function fileSize(file: Glb, scaleCm: number) {
  const boxes = [...materialBoxes(file, scaleCm).values()]
  const span = (axis: 'x' | 'y' | 'z') => {
    const lo = Math.min(...boxes.map((b) => b[axis][0]))
    return Math.max(...boxes.map((b) => b[axis][1])) - lo
  }
  return { width: span('x'), depth: span('z'), height: span('y') }
}

describe('the shipped GLB', () => {
  it.each(FOLDS)('%s publishes the box its OWN file measures', (id) => {
    const file = glbJson(glbPath(id))
    const { scaleCm, yawDeg, translated } = prep(file)
    expect(yawDeg).toBeCloseTo(180, 3)
    expect(translated).toEqual([])

    // `modelSize` is what `glb-prep` printed in metres to three places, ×100 — so
    // it IS the file's own box rounded to 0.1 cm, and this asserts that identity
    // rather than the numbers. Widest observed gap across the five: 0.045 cm.
    const measured = fileSize(file, scaleCm)
    const model = getCatalogEntry(id).modelSize!
    const to1 = (n: number) => Math.round(n * 10) / 10
    expect([id, to1(measured.width), to1(measured.depth), to1(measured.height)])
      .toEqual([id, model.width, model.depth, model.height])
  })

  /**
   * ⭐ `-horizontal` alone was re-exported segmented on 2026-08-02 so its napkin
   * could be coloured, and both markings on it were applied by NAME
   * (`mark-material --only`, handoff/FOUND-01-horizontal.md). A re-run of
   * `glb-prep` erases both without failing anything else in this suite.
   */
  it('⭐ -horizontal still carries the `glass` AND `napkin` markings', () => {
    const names = glbJson(glbPath('decor.place-setting-horizontal')).materials.map((m) => m.name)
    expect(names.filter((n) => n.startsWith('glass')).length).toBeGreaterThan(0)
    expect(names.filter((n) => n.startsWith('napkin'))).toEqual(['napkin-00'])
    // unique under a shared prefix (README:73-75) — one name for many primitives
    // makes `propModel` keep only the first one's baked material
    expect(new Set(names).size).toBe(names.length)
  })

  /**
   * The marking is two DRINKING VESSELS, not a blob. The segmented export shatters
   * them into 52 parts, which is exactly why `mark-glass.mjs`'s clustering bridged
   * through the shards and had to be replaced — so the thing to assert is the
   * shape of the answer: the marked parts fall into two runs along x, each no
   * wider than a ⌀9 cm glass, and the napkin crosses the gap between them.
   */
  it('marks the horizontal cover as two ⌀9 cm vessels, and leaves the napkin out', () => {
    const file = glbJson(glbPath('decor.place-setting-horizontal'))
    const boxes = materialBoxes(file, prep(file).scaleCm)
    const glass = [...boxes.entries()].filter(([n]) => n.startsWith('glass')).map(([, b]) => b)
    expect(glass.length).toBeGreaterThan(2) // it IS shattered; that is the premise

    const runs: [number, number][] = []
    for (const b of [...glass].sort((p, q) => p.x[0] - q.x[0])) {
      const last = runs.at(-1)
      if (last && b.x[0] <= last[1]) last[1] = Math.max(last[1], b.x[1])
      else runs.push([b.x[0], b.x[1]])
    }
    expect(runs).toHaveLength(2)
    for (const [lo, hi] of runs) expect(hi - lo).toBeLessThan(9.5)

    // the napkin lies ACROSS the plate — wider than both vessels put together, and
    // spanning the gap they stand apart by, so it could never be one of them
    const napkin = boxes.get('napkin-00')!
    expect(napkin.x[1] - napkin.x[0]).toBeGreaterThan(20)
    expect(napkin.x[0]).toBeLessThan(runs[1][0])
    expect(napkin.x[1]).toBeGreaterThan(runs[1][1])
  })

  /**
   * Every fold's glassware is glass, and TWO of the five got there the hard way.
   *
   * `mark-glass.mjs` is geometric and each of those two defeats it differently:
   * `-tied`'s wine glass clusters with the napkin ring (11.3 × 13.7 cm against
   * `COLUMN_MAX` 11.0 — 0.3 cm), and the re-exported `-horizontal` shatters both
   * vessels into 52 shards the clustering bridges through. Both were named with
   * `mark-material --only` after a containment measurement, and both are read back
   * from the shipped file here.
   *
   * ⚠ The assertion is deliberately over the WHOLE list rather than a count: an
   * empty `FOLDS`, or a filter that quietly stopped matching, would satisfy
   * "four of five" and satisfy a `.every()` too.
   */
  it('carries a glass marking on all five folds', () => {
    const marked = FOLDS.filter((id) =>
      glbJson(glbPath(id)).materials.some((m) => m.name.startsWith('glass')))
    expect(marked).toEqual(FOLDS)
    expect(FOLDS).toHaveLength(5)
  })

  /**
   * …and the marking reaches BOTH vessels, not just whichever one a rule happened
   * to find. This is what fails if a future `--only` call names one material and
   * forgets its twin — the exact shape of the bug that left `-tied` half-marked.
   *
   * ⚠ NOT asserted here: unique names. `mark-glass.mjs` gives every vessel part the
   * same `glass-tall`/`glass-short` pair of names, so `-vertical` carries three
   * glass materials under two names — and that is fine, unlike for the napkin above
   * where the test DOES demand uniqueness. The difference is what the name buys:
   * `propModel.buildParts` merges primitives sharing a material name and keeps only
   * the first, which would dress nine napkin parts in part 0's maps over eight other
   * UV layouts. A glass part has no maps to lose — `BUILT_MATERIALS` matches the
   * `glass` PREFIX and replaces all of them with one shared singleton, so the merge
   * is a saved draw call rather than a lost texture.
   */
  it.each(FOLDS)('%s marks both vessels, not just the one a rule could see', (id) => {
    const names = glbJson(glbPath(id))
      .materials.map((m) => m.name)
      .filter((n) => n.startsWith('glass'))
    expect(names.length).toBeGreaterThanOrEqual(2)
  })
})

/**
 * `mark-material.mjs --only` is what put the names above into the file, and its
 * one job beyond renaming is to REFUSE a name it cannot find. A typo there does
 * not crash and does not corrupt anything — it marks nothing, writes the file,
 * exits 0, and the glass is quietly opaque. That is the failure the tool exists
 * to prevent, so it is worth the two process spawns (≈0.2 s each).
 */
describe('tools/glb-prep/mark-material.mjs --only', () => {
  const TOOL = 'tools/glb-prep/mark-material.mjs'
  const GLB = glbPath('decor.place-setting-horizontal')
  /** run the tool, hand back {status, out} instead of throwing on a non-zero exit */
  const run = (args: string[]) => {
    try {
      return { status: 0, out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8', stdio: 'pipe' }) }
    } catch (e) {
      const err = e as { status: number; stdout?: string; stderr?: string }
      return { status: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    }
  }

  it('fails LOUDLY on a name that is not in the file', () => {
    const { status, out } = run([GLB, '--only', 'glass-00,glass-nope', 'glass', '--dry'])
    expect(status).toBe(1)
    expect(out).toContain('glass-nope')
  })

  it('names what it will touch and what it will not, and writes neither under --dry', () => {
    const before = readFileSync(GLB)
    const { status, out } = run([GLB, '--only', 'napkin-00', 'napkin', '--dry'])
    expect(status).toBe(0)
    expect(out).toContain('napkin-00')
    expect(out).toContain('untouched (66)')
    expect(out).toContain('--dry: nothing written')
    expect(readFileSync(GLB).equals(before)).toBe(true)
  })

  it('refuses --all and --only together, so neither can shadow the other', () => {
    // `--all` renames EVERY material; silently winning over an `--only` list would
    // turn a cutlery part into glass and nothing downstream would say so
    expect(run([GLB, '--all', 'glass', '--only', 'napkin-00', 'napkin']).status).toBe(2)
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
 * The napkin colour picker (PLAN-01 §3.7). ALL FIVE covers offer it — and the way
 * the fifth got there is the part worth reading.
 *
 * The slot only works because the napkin's GLB materials are named `napkin-…`, and
 * that naming is a MEASUREMENT rather than a decision. Four covers were named by
 * `tools/glb-prep/mark-napkin.mjs`, which refuses with exit code 1 on a file where
 * the napkin cannot be told from the charger — and it refused `-horizontal`, whose
 * first import welded the napkin INTO the charger's primitive.
 *
 * The user re-exported that one cover segmented. Its napkin was then named with
 * `mark-material --only`, by name, because `mark-napkin` STILL refuses the new file
 * for an unrelated reason: the re-export splits the charger into two equal crescents
 * either side of the napkin, so "the napkin sits on the charger" — one part, overlap
 * ≈ 1 — is no longer expressible, and it measures 0.31 against each half. The
 * colour test the tool applies passes there (Δ 0.151 against a 0.120 bar); it is the
 * overlap gate that has stopped fitting the asset.
 *
 * ⇒ Two markers, one interface. Both write a name, `editableSlots[].match` reads a
 * prefix, and the entry below cannot tell which tool wrote it. What holds this
 * together is not either tool but `the shipped GLB still carries the marking`
 * above, which reads the file back and fails if a re-run of `glb-prep` erased it.
 */
describe('the napkin colour picker', () => {
  /** every cover, with the mean napkin texel measured on that very file */
  const MARKED: ReadonlyArray<readonly [string, string]> = [
    ['decor.place-setting-diagonal', '#c6c2c3'],
    ['decor.place-setting-vertical', '#b9b5b2'],
    ['decor.place-setting-folded', '#797d6c'],
    ['decor.place-setting-tied', '#7d5d49'],
    ['decor.place-setting-horizontal', '#ada9a8'],
  ]

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

  it('leaves the napkin-less original cover alone — it has no napkin to colour', () => {
    // the sixth cover is the one that ships WITHOUT a fold, so there is nothing for
    // the picker to own. Asserted here rather than assumed: it is the entry an
    // over-eager `cover()` change would sweep up first.
    const entry = getCatalogEntry(ORIGINAL)
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

    it('leaves the napkin-less original unmarked, matching its empty slot list', () => {
      expect(materialNames(ORIGINAL).filter((n) => n.startsWith('napkin'))).toEqual([])
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
