/**
 * Where each zone's name tag sits on the 2D plan.
 *
 * Source doc §17: "the pool's name runs over the chuppah's name". That is not a
 * styling problem — it is geometry. The chuppah rectangle (1809,1651,760×425)
 * lies INSIDE the pool one (766,1408,3073×1136), and so does the DJ booth
 * (2269,1408,310×243). Two rectangles that contain one another have centres a
 * few metres apart, so two centred tags land on top of each other no matter how
 * small or what colour they are.
 *
 * So the tag position is solved, not chosen: zones are placed SMALLEST FIRST
 * (a small zone has the least room to move), each one takes the first candidate
 * slot — centre, then edge midpoints, then corners — that stays clear of every
 * tag already down, and the big zone that contains it is the one that gives way.
 * Deterministic, and a pure function so it can be tested at all (BRIEF §1.7:
 * vitest runs `environment: 'node'`, there are no DOM tests).
 *
 * ⚠ A TAG MUST ALSO KEEP OFF A ZONE THAT IS PAINTED OVER ITS OWN, and that
 * second rule is COUPLED TO THE DRAW ORDER rather than to any new constant.
 * VenueLayer draws zone fills BIGGEST-AREA FIRST, so a smaller zone's tint lands
 * on top of a bigger one's; this function walks SMALLEST-first, so at the moment
 * zone `i` is placed, `placed` holds exactly the zones that will be painted OVER
 * it. Scoring against their rectangles is therefore scoring against the tints
 * that will actually cover this tag — no weight, no threshold, and the two
 * orders cannot drift apart without one of them being deliberately reversed.
 *
 * The two costs are LEXICOGRAPHIC, not summed: label-on-label first, zone-rect
 * only to break a tie. A tag over another tag is unreadable; a tag over a
 * neighbouring tint is merely untidy, and a summed score would let enough of the
 * second outvote a little of the first.
 *
 * `LABEL_GAP` applies to the label term ONLY. It is clear air demanded between
 * two TEXTS; a tag may sit hard against a neighbouring zone's edge.
 *
 * What this fixed, measured: the pool's tag landed at y 2047.5…2107.5 while the
 * chuppah zone rectangle ends at y 2076, printing 380 × 28.5 cm of "בריכה" on
 * the ceremony pad's tint. The `bottom` candidate was 392 cm clear the whole
 * time — the old scorer simply never asked.
 *
 * Everything here is plan cm, matching `RestrictedZone`.
 */
import type { RestrictedZone } from '../venuePacks'

export interface ZoneLabelBox {
  kind: string
  x: number
  y: number
  w: number
  h: number
}

/** cm the tag keeps off its zone's edge. Shrinks on a zone too small to afford it. */
export const LABEL_INSET = 16
/** cm — one line of zone name. Was 210; the tag is a plan annotation now, not a chip. */
export const LABEL_BASE_HEIGHT = 60
/** cm added for the second line when the zone carries an `elevation` (`+4.70`). */
export const LABEL_ELEVATION_HEIGHT = 46
export const LABEL_MAX_WIDTH = 380
/**
 * cm of clear air demanded between two tags. Plain non-overlap is not enough:
 * with 60 cm tags the pool and the chuppah miss each other by 29 cm, which at
 * fit-the-venue zoom is three pixels and still reads as one smudged line. This
 * is what actually pushes the pool's tag off centre.
 */
export const LABEL_GAP = 60

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 })

/** Do two label boxes touch at all? The invariant the test asserts. */
export function labelBoxesOverlap(a: ZoneLabelBox, b: ZoneLabelBox): boolean {
  return overlapArea(a, b) > 0
}

/**
 * cm — the narrowest box worth writing a name in, as a multiple of the drawn
 * font size. The two 120 cm `saviv` strips beside the pool leave an 88 cm box,
 * and `ellipsis` turned "סביב הבריכה" into a bare "…" floating on the plan. A
 * chip could get away with that; ink on a drawing cannot, so a zone whose tag
 * cannot hold a word simply goes unnamed.
 */
export const LABEL_MIN_WIDTH_EMS = 3

/** Is there room to write in this box at all, at the size it will be drawn? */
export function labelFits(box: ZoneLabelBox, fontSize: number): boolean {
  return box.w >= fontSize * LABEL_MIN_WIDTH_EMS && box.h >= fontSize
}

/** Tag size for one zone, before it is placed. Never larger than the zone itself. */
function labelSize(zone: RestrictedZone): { w: number; h: number; inset: number } {
  // A 40 cm wide zone cannot afford a 16 cm inset on both sides; quartering keeps
  // the tag inside its zone whatever the extractor emits.
  const inset = Math.min(LABEL_INSET, zone.width / 4, zone.depth / 4)
  const wanted = LABEL_BASE_HEIGHT + (zone.elevation === undefined ? 0 : LABEL_ELEVATION_HEIGHT)
  return {
    w: Math.min(LABEL_MAX_WIDTH, Math.max(1, zone.width - inset * 2)),
    h: Math.min(wanted, Math.max(1, zone.depth - inset * 2)),
    inset,
  }
}

/**
 * Slots to try, in order of preference: centre first (what a plan wants), then
 * the four edge midpoints, then the four corners. All are inside the zone.
 */
function candidates(zone: RestrictedZone, w: number, h: number, inset: number): Rect[] {
  const ix = zone.x + inset
  const iy = zone.y + inset
  const iw = Math.max(w, zone.width - inset * 2)
  const ih = Math.max(h, zone.depth - inset * 2)
  const cx = ix + (iw - w) / 2
  const cy = iy + (ih - h) / 2
  const right = ix + iw - w
  const bottom = iy + ih - h
  return [
    { x: cx, y: cy, w, h }, // centre
    { x: cx, y: iy, w, h }, // top edge
    { x: cx, y: bottom, w, h }, // bottom edge
    { x: ix, y: cy, w, h }, // left edge
    { x: right, y: cy, w, h }, // right edge
    { x: ix, y: iy, w, h },
    { x: right, y: iy, w, h },
    { x: ix, y: bottom, w, h },
    { x: right, y: bottom, w, h },
  ]
}

/**
 * A tag already down, and the zone it belongs to. Both are needed: the box is
 * what a later tag must not touch, the rect is what a later tag should not sit
 * on — see the header on why the second one is free of any tuning.
 */
interface Placed {
  box: Rect
  rect: Rect
}

/**
 * One tag box per zone, in the SAME ORDER as the input array (the caller keys
 * off its own zone list, and two zones can share a `kind` in principle).
 */
export function zoneLabelBoxes(zones: readonly RestrictedZone[]): ZoneLabelBox[] {
  // smallest area first — a small zone has the fewest slots that are still
  // inside it, so it gets to keep its centre and the big one moves. It is also
  // what makes `placed` mean "painted over me" (header).
  const order = zones
    .map((zone, index) => ({ zone, index }))
    .sort((a, b) => a.zone.width * a.zone.depth - b.zone.width * b.zone.depth)

  const out = new Array<ZoneLabelBox>(zones.length)
  const placed: Placed[] = []

  for (const { zone, index } of order) {
    const { w, h, inset } = labelSize(zone)
    const rect: Rect = { x: zone.x, y: zone.y, w: zone.width, h: zone.depth }
    const slots = candidates(zone, w, h, inset)
    let best = slots[0]
    let bestLabel = Infinity
    let bestTint = Infinity
    for (const slot of slots) {
      // LABEL_GAP is clear air between two TEXTS, so it grows the label term and
      // nothing else — a tag may sit against a neighbouring zone's edge.
      const grown = grow(slot, LABEL_GAP / 2)
      let label = 0
      let tint = 0
      for (const other of placed) {
        label += overlapArea(grown, grow(other.box, LABEL_GAP / 2))
        tint += overlapArea(slot, other.rect)
      }
      // a slot that is clear of both is unimprovable — take it and stop
      if (label === 0 && tint === 0) {
        best = slot
        bestLabel = 0
        bestTint = 0
        break
      }
      // LEXICOGRAPHIC: text-on-text decides, tint-under-text only breaks a tie
      if (label < bestLabel || (label === bestLabel && tint < bestTint)) {
        best = slot
        bestLabel = label
        bestTint = tint
      }
    }
    placed.push({ box: best, rect })
    out[index] = { kind: zone.kind ?? '', ...best }
  }

  return out
}

/**
 * U+2066 LEFT-TO-RIGHT ISOLATE and U+2069 POP DIRECTIONAL ISOLATE — zero-width
 * format characters, never drawn, that pin the run between them to LTR whatever
 * the surrounding paragraph direction is.
 */
// written as escapes on purpose: pasted literally they are invisible in the
// editor and in every diff, and nobody can maintain what they cannot see.
export const LTR_ISOLATE = '\u2066'
export const POP_ISOLATE = '\u2069'

/**
 * Architectural level mark: 470 cm → `+4.70`, 50 → `+0.50`.
 *
 * ⚠ The isolate is not decoration. The app is `dir="rtl"`, the Konva canvas
 * inherits that direction, and an unisolated `+4.70` came out of `fillText` as
 * `4.70+` with the sign flipped to the right — photographed under "קבלת פנים".
 *
 * ⚠ And `direction="ltr"` on the Konva `<Text>` does NOT fix it: Konva resolves
 * `direction` and then only ever calls `setAttr('direction', 'rtl')`, with no
 * branch that sets it back (`Text._sceneFunc`), so a canvas already inheriting
 * rtl stays rtl. Isolating the STRING is the fix that holds — and it holds in
 * HTML and in exports too, not just on this one canvas node, which is why it
 * lives in core next to the value rather than in the layer that draws it.
 */
export function formatElevation(cm: number): string {
  const mark = `${cm < 0 ? '-' : '+'}${(Math.abs(cm) / 100).toFixed(2)}`
  return `${LTR_ISOLATE}${mark}${POP_ISOLATE}`
}
