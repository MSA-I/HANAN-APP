/**
 * The library filter, against the REAL catalogue (BRIEF §1.7: constants come
 * from the catalog, never from a copy hand-written in the test).
 *
 * Legal as a `src/ui/*.test.ts` because `librarySearch.ts` is DOM-free: it
 * imports the catalog types and `strings.ts`, which itself imports nothing.
 */
import { describe, expect, it } from 'vitest'
import { listCatalog, getCatalogEntry } from '../core/catalog/registry'
import {
  entryMatchesQuery,
  itemLabel,
  normalizeSearch,
  searchFieldsOf,
  searchTokens,
} from './librarySearch'
import { strings } from './strings'

const ids = (query: string) =>
  listCatalog()
    .filter((e) => entryMatchesQuery(e, searchTokens(query)))
    .map((e) => e.id)

describe('normalizeSearch', () => {
  it('is idempotent', () => {
    for (const sample of ['סכו״ם ומפיות', 'Table.Round', '  שולחן   עגול  ', '']) {
      expect(normalizeSearch(normalizeSearch(sample))).toBe(normalizeSearch(sample))
    }
  })

  it('JOINS an in-word mark rather than splitting on it', () => {
    // The failure this file exists for: the label carries U+05F4 GERSHAYIM and
    // the user types the plain word, so `includes` found nothing.
    // ⚠ The near-miss worth pinning is turning the mark into a SPACE — that
    // yields two tokens and the plain spelling still finds nothing. One token,
    // and the same one either spelling produces.
    expect(searchTokens('סכו״ם')).toHaveLength(1)
    expect(normalizeSearch('סכו״ם')).toBe(normalizeSearch('סכום'))
    // the DJ stand's keyword carries a geresh, the same case one mark down
    expect(searchTokens('דיג׳יי')).toHaveLength(1)
  })

  it('folds the five Hebrew final forms onto their ordinary letters', () => {
    // Without this a singular is not a substring of its own plural, which is the
    // rule every keyword list in the catalogue is written on.
    expect(normalizeSearch('שולחנות').startsWith(normalizeSearch('שולחן'))).toBe(true)
    expect(normalizeSearch('צמחים').startsWith(normalizeSearch('צמח'))).toBe(true)
    // all five pairs, so a future edit cannot drop one silently
    expect(normalizeSearch('ךםןףץ')).toBe(normalizeSearch('כמנפצ'))
  })

  it('strips nikud rather than treating a pointed word as a different one', () => {
    expect(normalizeSearch('שָׁלוֹם')).toBe(normalizeSearch('שלום'))
  })

  it('splits an id into words and lowercases it', () => {
    expect(normalizeSearch('Table.Round-Large')).toBe('table round large')
  })

  it('produces no empty tokens', () => {
    expect(searchTokens('   ')).toEqual([])
    expect(searchTokens('')).toEqual([])
    // no final letters in either word, so the tokens come back unchanged and the
    // assertion is about the SPLIT rather than about the fold
    expect(searchTokens(' כסא   עגול ')).toEqual(['כסא', 'עגול'])
  })
})

describe('entryMatchesQuery', () => {
  it('shows the whole catalogue for an empty query', () => {
    expect(ids('')).toHaveLength(listCatalog().length)
    expect(ids('   ')).toHaveLength(listCatalog().length)
  })

  it('finds the plural of a word the catalogue only spells in the singular', () => {
    const found = ids('שולחנות')
    expect(found).toContain('table.round')
    expect(found).toContain('table.serpentine')
  })

  it('matches a two-word query in any order', () => {
    // the old filter tested ONE label with `includes`, so word order mattered
    expect(ids('שולחן עגול')).toContain('table.round')
    expect(ids('עגול שולחן')).toContain('table.round')
  })

  it('finds the cutlery cover by the spelling without the gershayim', () => {
    expect(ids('סכום')).toContain('decor.place-setting')
    expect(ids('סכו״ם')).toContain('decor.place-setting')
  })

  it('finds all six guest chairs by either spelling of the word', () => {
    for (const spelling of ['כסא', 'כיסא']) {
      const found = ids(spelling)
      for (const id of ['chair.x-white', 'chair.x-wood', 'chair.gold-white', 'chair.gold-black', 'chair.brown', 'chair.black']) {
        expect(found, `${spelling} → ${id}`).toContain(id)
      }
    }
  })

  it('finds an item by its id, which is the only English handle it has', () => {
    expect(ids('divider')).toEqual(['divider.screen'])
  })

  it('finds an item through its category name', () => {
    // 'ישיבה' is the category label, not any chair's own label
    expect(ids('ישיבה').length).toBeGreaterThanOrEqual(6)
  })

  it('does not let one token span two fields', () => {
    // ' | ' between fields, so a query built from the tail of one and the head of
    // the next matches nothing. Without the separator this would find the bar.
    const bar = getCatalogEntry('bar.resort-left')
    expect(searchFieldsOf(bar)).toContain(' | ')
    expect(ids('רומזנון')).toEqual([])
  })

  it('returns nothing for a word that is in no entry', () => {
    expect(ids('מסוק')).toEqual([])
  })

  it('reads the same fields on every call — the cache cannot go stale', () => {
    const entry = getCatalogEntry('table.round')
    expect(searchFieldsOf(entry)).toBe(searchFieldsOf(entry))
  })
})

describe('the quick-filter chips', () => {
  const chips = strings.library.chips

  it('every chip finds something', () => {
    for (const chip of chips) {
      expect(ids(chip).length, `chip "${chip}"`).toBeGreaterThan(0)
    }
  })

  it('no chip returns the whole library — a filter that filters nothing is a lie', () => {
    const total = listCatalog().length
    for (const chip of chips) {
      expect(ids(chip).length, `chip "${chip}"`).toBeLessThan(total)
    }
  })

  it('each chip is ONE plain word, so what it shows is what it searches', () => {
    // The chip is BOTH the label and the query (strings.library.chips). It may be
    // FOLDED — 'שולחן' is matched as 'שולחנ' — but nothing may be DROPPED, which
    // is what a stray gershayim or a two-word chip would do.
    for (const chip of chips) {
      expect(searchTokens(chip), `chip "${chip}"`).toHaveLength(1)
      expect(normalizeSearch(chip).length, `chip "${chip}"`).toBe(chip.length)
    }
  })

  it('lists no duplicates', () => {
    expect(new Set(chips).size).toBe(chips.length)
  })
})

describe('itemLabel', () => {
  it('resolves a Hebrew label for every entry in the catalogue', () => {
    const unlabelled = listCatalog().filter((e) => itemLabel(e) === e.id).map((e) => e.id)
    expect(unlabelled).toEqual([])
  })
})
