/**
 * The small English-language helpers the prompt is assembled from: how many of a
 * thing there are, and what colour it was changed to.
 *
 * Prompts are English on purpose (PLAN-08 gate 4): every documented image model
 * is trained predominantly on English captions, and the Hebrew UI strings are
 * user-facing labels, not descriptions of what a thing looks like. Nothing in
 * here is shown in the UI, so none of it belongs in ui/strings.ts.
 */
import type { AppearanceOverrides } from '../model/types'
import type { CatalogEntry } from '../catalog/types'

/**
 * The image budget, and the whole of its arithmetic.
 *
 * ⚠ THE ONE PLACE THESE NUMBERS LIVE. 16 is the documented input ceiling of
 * OpenAI's image-edit endpoint for gpt-image-1, not a guess — it was round 1's
 * G8 decision, and the user's "10" in §45 of the source document was the figure
 * being corrected. The package must never exceed it:
 *
 *   16 total = 1 capture + 1 materials + 1 background + up to 5 fixed + design refs
 *
 * The capture counts: it is an input image like any other. `materials` and
 * `background` are the two fixed references every angle carries (refs.ts).
 * `fixed` is §26's route for the hall's OWN fittings — the bar, the DJ booth,
 * the planters — which are selected ahead of the design cut so they stop being
 * the first thing to fall out of a crowded frame.
 *
 * MAX_DESIGN_REFS is therefore the WORST case: what is left when five fixed
 * elements are in shot. Most frames hold fewer, so `designRefBudget` hands the
 * unclaimed fixed slots back rather than wasting them.
 *
 * The model that will actually be used was named "GPT IMAGE 2.0", which could
 * not be verified to exist; when the real target is settled, MAX_INPUT_IMAGES is
 * the whole change.
 */
export const MAX_INPUT_IMAGES = 16
/** the capture itself */
const CAPTURE_SLOTS = 1
/** HALL_MATERIAL_REF + BACKGROUND_REF, both present on every angle */
const ALWAYS_ON_SLOTS = 2
/** §26: how many of the hall's own fittings may be illustrated */
export const MAX_FIXED_REFS = 5
/** 16 − 1 capture − 1 materials − 1 background − 5 fixed = 8 */
export const MAX_DESIGN_REFS =
  MAX_INPUT_IMAGES - CAPTURE_SLOTS - ALWAYS_ON_SLOTS - MAX_FIXED_REFS

/**
 * How many design references fit alongside `fixedCount` fixed ones — the floor
 * above plus every fixed slot nobody took. Fewer than five fixed elements in
 * frame must not cost the design list its pictures.
 *
 * Total images are `1 + refs.length`, and this function is what keeps that at or
 * under MAX_INPUT_IMAGES for any fixed count at all (compose.test.ts pins it).
 */
export function designRefBudget(fixedCount: number): number {
  const used = Number.isFinite(fixedCount)
    ? Math.min(Math.max(Math.trunc(fixedCount), 0), MAX_FIXED_REFS)
    : 0
  return MAX_DESIGN_REFS + (MAX_FIXED_REFS - used)
}

/**
 * hex → an English colour word an image model will act on.
 *
 * The first twelve ARE the event palette (ui/fields.tsx EVENT_SWATCHES) and are
 * matched exactly — those are the only colours the six tables and the napkins
 * can be set to from the fixed picker. The rest exist for the two napkins, whose
 * slots carry `allowCustomColor` and so accept any hex at all; they are a coarse
 * net cast over the wheel rather than a colour system.
 *
 * ponytail: a 30-name table and nearest-neighbour, not chroma-js. A dependency
 * to turn a hex into one of thirty words is a dependency to audit forever.
 */
const COLOR_NAMES: [hex: string, name: string][] = [
  // --- the event palette, verbatim ---
  ['#ffffff', 'white'],
  ['#f5f0e8', 'ivory'],
  ['#eddcc5', 'champagne'],
  ['#e8c4c4', 'blush pink'],
  ['#c98d8d', 'dusty rose'],
  ['#b96a4b', 'terracotta'],
  ['#c9a86a', 'gold'],
  ['#a8b5a0', 'sage green'],
  ['#708c5f', 'olive green'],
  ['#33518f', 'royal blue'],
  ['#7a2e3f', 'burgundy'],
  ['#3a3633', 'charcoal'],
  // --- general cover for the free picker ---
  ['#000000', 'black'],
  ['#808080', 'grey'],
  ['#c0c0c0', 'silver'],
  ['#f5f5dc', 'cream'],
  ['#d2b48c', 'tan'],
  ['#8b7355', 'taupe'],
  ['#6b4423', 'chocolate brown'],
  ['#b7410e', 'rust'],
  ['#ff7f00', 'orange'],
  ['#ffbf00', 'amber'],
  ['#ffd700', 'yellow'],
  ['#2e8b57', 'emerald green'],
  ['#008080', 'teal'],
  ['#40e0d0', 'turquoise'],
  ['#87ceeb', 'sky blue'],
  ['#000080', 'navy blue'],
  ['#7b3f9d', 'purple'],
  ['#ff00ff', 'magenta'],
  ['#ff69b4', 'hot pink'],
  ['#d40000', 'red'],
]

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = Number.parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Redmean distance — the cheap weighted-RGB approximation of perceptual
 * difference. Plain Euclidean RGB is the same amount of code and gets dark and
 * saturated colours visibly wrong (it will call a deep burgundy "black"), which
 * is exactly the range the event palette lives in.
 */
function distance(a: [number, number, number], b: [number, number, number]): number {
  const rMean = (a[0] + b[0]) / 2
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
}

/** The nearest of the 30 names. Unparseable input falls back to the raw string. */
export function hexToColorName(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  let best = COLOR_NAMES[0]
  let bestD = Infinity
  for (const candidate of COLOR_NAMES) {
    const d = distance(rgb, parseHex(candidate[0])!)
    if (d < bestD) {
      bestD = d
      best = candidate
    }
  }
  return best[1]
}

/**
 * ` in gold`, or null when the colour is untouched (§44: mention the colour only
 * "if it was changed from the left-hand menu").
 *
 * Only an entry's ONE `editableColorSlot` can have been changed — every other
 * slot is fixed in the catalog and, for the entries that carry a real GLB, is
 * baked into the model anyway, so its slot colour describes the 2D footprint
 * rather than anything the image model would see.
 */
export function colorPhrase(entry: CatalogEntry, appearance: AppearanceOverrides): string | null {
  const slot = entry.editableColorSlot
  if (!slot) return null
  const chosen = appearance[slot]?.color
  const fallback = entry.materialSlots.find((s) => s.name === slot)?.defaultColor
  if (!chosen || chosen.toLowerCase() === fallback?.toLowerCase()) return null
  return ` in ${hexToColorName(chosen)}`
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/**
 * A count as an English word: "twelve round tables" reads as a quantity to a
 * language model, "12 round tables" reads as part of a product name. Above 999
 * — which no real hall reaches — the digits are the honest answer.
 */
export function quantityWord(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999 || !Number.isInteger(n)) return String(n)
  if (n < 20) return ONES[n]
  if (n < 100) {
    const rest = n % 10
    return TENS[Math.floor(n / 10)] + (rest ? `-${ONES[rest]}` : '')
  }
  const rest = n % 100
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${quantityWord(rest)}` : ''}`
}

/** "a folded napkin" → "twelve folded napkins" (the fragment is written singular). */
export function pluralize(fragment: string, count: number): string {
  if (count <= 1) return fragment
  const withoutArticle = fragment.replace(/^(a|an) /i, '')
  // the fragments are noun phrases whose head noun is followed by a modifier
  // ("... table with floor-length linen"), so pluralise the head, not the tail
  const head = /^(.*?)( with | on | in | under | over |$)/s.exec(withoutArticle)
  if (!head) return `${quantityWord(count)} ${withoutArticle}`
  const noun = head[1].endsWith('s') ? `${head[1]}es` : `${head[1]}s`
  return `${quantityWord(count)} ${noun}${withoutArticle.slice(head[1].length)}`
}
