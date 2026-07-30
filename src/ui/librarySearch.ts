/**
 * What the library's search box actually matches on.
 *
 * The old filter was `itemLabel(entry).includes(query.trim())` — one exact,
 * case-sensitive substring test against one Hebrew label. Three things went
 * wrong with it, all of them silently: 'סכום' found nothing because the label is
 * 'סכו״ם' with a gershayim in the middle, 'כיסא' found nothing because the
 * labels spell it 'כסא', and typing two words found nothing at all unless they
 * appeared in that order in the one label.
 *
 * The rules here are the answer to those three, and nothing more:
 *
 *  - NORMALISE both sides. Two different jobs, in this order: the marks that sit
 *    INSIDE a word — nikud, diacritics, geresh, gershayim — are REMOVED, joining
 *    what they separate, which is what makes 'סכו״ם' and 'סכום' the same word;
 *    everything else that is not a letter or a digit becomes a SPACE, which is
 *    what makes 'table.round' into 'table round'. Then the five Hebrew final
 *    forms are folded, so 'שולחן' is a prefix of 'שולחנות'.
 *  - Search MORE THAN THE LABEL: the entry's `keywords` (Hebrew synonyms
 *    authored on the catalog factories), its category's Hebrew name, and its id.
 *  - Every TOKEN of the query must appear somewhere. Tokens are matched
 *    independently and in any order, so 'שולחן עגול' finds the round table.
 *
 * DOM-free on purpose. `ui/strings.ts` imports nothing, so this file's only
 * dependencies are strings and the catalog types — which is what makes
 * `librarySearch.test.ts` legal under a `environment: 'node'` runner that
 * collects `src/**` /*.test.ts only (BRIEF §1.7).
 */
import type { CatalogEntry } from '../core/catalog/types'
import { strings } from './strings'

/**
 * Marks REMOVED OUTRIGHT, joining what is on either side of them.
 *
 *   U+0300…U+036F  Latin combining diacritics
 *   U+0591…U+05C7  Hebrew cantillation, nikud, dagesh, sin/shin dots, meteg
 *   U+05F3 U+05F4  geresh and gershayim — the in-word abbreviation marks
 *   ' " U+2019     the ASCII and typographic stand-ins people type for them
 *
 * ⚠ REMOVED, not turned into a space, and the distinction is the whole point.
 * These marks sit INSIDE a word: the cutlery label is spelled with a gershayim
 * between its third and fourth letters, and the DJ stand carries a geresh.
 * Spacing them would split one word into two tokens, so a user typing the
 * plain spelling would still find nothing — which is the bug this file exists
 * to fix, not a smaller version of it.
 *
 * NFD runs first, so a precomposed character decomposes into base + mark and
 * the mark is what this removes.
 *
 * Written as escapes rather than pasted, for the reason
 * core/layout/zoneLabels.ts records about its bidi isolates: a combining mark
 * pasted into a character class is invisible in the editor and in every diff,
 * and nobody can maintain what they cannot see. U+05BE MAQAF falls inside the
 * second range and is therefore joined too, which is the same treatment a
 * hyphen would want and affects no label in the catalogue today.
 */
const ELIDED = /[\u0300-\u036f\u0591-\u05c7\u05f3\u05f4\u2019'"]/g

/**
 * Everything that is NOT a letter, a digit or a space becomes a space.
 *
 * `\p{L}` would be the honest spelling but needs the `u` flag; this is the
 * explicit set the app actually contains — ASCII letters and digits plus the
 * twenty-seven Hebrew letters, U+05D0…U+05EA. It runs AFTER `ELIDED`, so what
 * reaches it is genuine separators: this is the rule that splits "table.round"
 * into two tokens, while the in-word marks have already been joined away.
 */
const NON_WORD = /[^0-9a-z\u05d0-\u05ea\s]/g

/**
 * The five Hebrew FINAL forms, folded onto their ordinary letters.
 *
 * ⚠ WITHOUT THIS, A SINGULAR DOES NOT FIND ITS OWN PLURAL, which is the whole
 * premise the keyword lists are written on. A word ending in one of these five
 * letters swaps it for the ordinary form the moment a suffix follows, so the
 * singular is not a substring of the plural at all:
 *
 *   \u05e9\u05d5\u05dc\u05d7\u05df  (table)   vs  \u05e9\u05d5\u05dc\u05d7\u05e0\u05d5\u05ea  (tables)
 *   final nun U+05DF                 ordinary nun U+05E0
 *
 * Folded, both sides end in the ordinary letter and the substring test does
 * what the lists claim it does. It is the standard fold for Hebrew search, and
 * it is lossless for matching: no two distinct Hebrew words differ only by a
 * final form, because a final form can only ever appear at the end of a word.
 *
 * Written as escapes for the reason above; the pairs are, in order:
 *   kaf, mem, nun, pe, tsadi.
 */
const FINAL_FORMS: ReadonlyArray<[RegExp, string]> = [
  [/\u05da/g, '\u05db'],
  [/\u05dd/g, '\u05de'],
  [/\u05df/g, '\u05e0'],
  [/\u05e3/g, '\u05e4'],
  [/\u05e5/g, '\u05e6'],
]

/**
 * Fold a label or a query down to the form both sides are compared in.
 * Idempotent — `normalizeSearch(normalizeSearch(x)) === normalizeSearch(x)`.
 *
 * Order matters: the final-form fold runs BEFORE `NON_WORD`, because all five
 * final letters sit inside the letter range that rule preserves.
 */
export function normalizeSearch(text: string): string {
  let out = text.normalize('NFD').replace(ELIDED, '').toLowerCase()
  for (const [from, to] of FINAL_FORMS) out = out.replace(from, to)
  return out.replace(NON_WORD, ' ').replace(/\s+/g, ' ').trim()
}

/** The query as the words that must all be found. Empty query = no tokens. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearch(query)
  return normalized ? normalized.split(' ') : []
}

/** The Hebrew name on the tile, or the raw id when a labelKey has no string. */
export function itemLabel(entry: CatalogEntry): string {
  return strings.catalog.items[entry.labelKey as keyof typeof strings.catalog.items] ?? entry.id
}

/**
 * ' | ' rather than ' ', and the parts are joined AFTER each is normalised, so
 * the pipe is still there when the match runs. A token can never contain one
 * (normalisation turns it into a space), so no token can span two fields —
 * without it, an item labelled 'בר' followed by a category 'בר ומזנון' would
 * answer to the query 'ברב'. Nonsense queries are cheap; a nonsense MATCH is
 * what makes a search box feel broken.
 */
const FIELD_SEP = ' | '

/**
 * Module-level cache, keyed by the entry object.
 *
 * The catalogue is built once at import and never mutated (registry.ts holds one
 * frozen array), so an entry's searchable text cannot change after the first
 * call. This runs for every entry on every keystroke, which is the reason to
 * bother at all — ~90 entries × NFD + four replaces, per character typed.
 *
 * A WeakMap, so a hypothetical dynamically-built entry does not leak.
 */
const fieldsCache = new WeakMap<CatalogEntry, string>()

/** Everything about one entry a query may match, normalised and joined. */
export function searchFieldsOf(entry: CatalogEntry): string {
  const cached = fieldsCache.get(entry)
  if (cached !== undefined) return cached
  const parts = [
    itemLabel(entry),
    ...(entry.keywords ?? []),
    strings.catalog.categories[entry.category],
    entry.id,
  ]
  const fields = parts
    .map(normalizeSearch)
    .filter(Boolean)
    .join(FIELD_SEP)
  fieldsCache.set(entry, fields)
  return fields
}

/**
 * Does this entry satisfy every token of the query? No tokens = yes, which is
 * what makes an empty search box show the whole library.
 */
export function entryMatchesQuery(entry: CatalogEntry, tokens: readonly string[]): boolean {
  if (!tokens.length) return true
  const fields = searchFieldsOf(entry)
  return tokens.every((token) => fields.includes(token))
}
