/**
 * What the library tile prints under an item's name is decided per CATEGORY, not
 * per item (source doc §20: "most of the items in the library do not even need
 * dimensions … in addition the tables need a description of the number of
 * chairs"). Dimensions survive only on the things whose size decides whether they
 * fit a room; the tables print their chair count; the rest print nothing at all.
 *
 * Almost every entry inherits the value from a shared factory — `surfaceProp`
 * (four families), `ceilingProp`, `chair`, `chuppahDecorProp` — and 'size' is the
 * DEFAULT, so an entry that declares nothing still renders, silently, with a
 * footprint. That is what makes a sweep worth writing: an entry added to a family
 * that predates it, or a factory that loses the line in a refactor, fails here
 * instead of quietly printing centimetres at the user again.
 */
import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, listCatalog } from './registry'
import type { CatalogEntry, Category } from './types'

type SubtitleMode = NonNullable<CatalogEntry['librarySubtitle']>

/** The field's own documented default — an entry that omits it prints its size. */
const DEFAULT_MODE: SubtitleMode = 'size'

/**
 * The mapping the catalogue is expected to implement. Stating it here rather than
 * deriving it from the entries is the point: derived from what the code does, the
 * test would agree with any value at all.
 */
const EXPECTED: Record<Category, SubtitleMode> = {
  // the user asked for the chair count by name
  tables: 'seats',
  // big furniture, where the dimensions decide whether the piece fits
  bars: 'size',
  bridalChair: 'size',
  chuppah: 'size',
  decor: 'size',
  // a chair is a chair — all six are the same 45×45
  seating: 'none',
  // table-top pieces, bought by look
  tableDecor: 'none',
  tableware: 'none',
  tableDesigns: 'none',
  ringCenter: 'none',
  chuppahDecor: 'none',
  // hung in open air: the drop comes from the hang slider, not from the width
  lighting: 'none',
}

const modeOf = (entry: CatalogEntry): SubtitleMode => entry.librarySubtitle ?? DEFAULT_MODE

/**
 * One category-wide answer has an exception, and it is a RULE rather than an id.
 *
 * 'size' is on `decor` because "the dimensions decide whether the piece fits".
 * An entry carrying `placeAnywhere` has no such question — it fits everywhere by
 * construction, zones and walls included (catalog/types.ts) — so its footprint
 * decides nothing and printing it only invites the wrong reading. On the human
 * figure that reading is concrete: the model is a T-pose, so its width is the ARM
 * SPAN, and a tile saying "1.55 × 0.28 מ׳" under a person looks like a claim
 * about how big the person is.
 *
 * Deriving it from the flag keeps this file doing what its header says: the
 * mapping is still stated here rather than read back out of the entries, and a
 * new entry that quietly declares 'none' still fails.
 */
const expectedFor = (entry: CatalogEntry): SubtitleMode =>
  entry.placeAnywhere ? 'none' : EXPECTED[entry.category]

describe('library subtitle', () => {
  it('maps every category the library renders', () => {
    expect(CATEGORY_ORDER.length).toBeGreaterThan(0)
    expect(Object.keys(EXPECTED).sort()).toEqual([...CATEGORY_ORDER].sort())
  })

  it('declares the mapped mode on every entry', () => {
    const entries = listCatalog()
    expect(entries.length).toBeGreaterThan(0)
    const wrong = entries
      .filter((e) => modeOf(e) !== expectedFor(e))
      .map((e) => `${e.id} is '${modeOf(e)}', ${e.category} wants '${expectedFor(e)}'`)
    expect(wrong).toEqual([])
  })

  it("gives every 'seats' entry a count to print", () => {
    // without `seating` the panel falls back to 'size', so the tile would print
    // dimensions again and nothing would look broken enough to notice
    const seated = listCatalog().filter((e) => modeOf(e) === 'seats')
    expect(seated.length).toBeGreaterThan(0)
    const missing = seated.filter((e) => !e.seating || e.seating.defaultCount <= 0).map((e) => e.id)
    expect(missing).toEqual([])
  })
})
