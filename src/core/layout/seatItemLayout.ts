/**
 * Pure place-setting math: given the chair transforms seatLayout produced, put one
 * item on the table in front of each of them. Works in the SEAT's own frame, so
 * there is no round/rect branching — a seat already carries the direction its
 * guest faces, and that is the only thing the layout needs.
 */
import type { Outline } from '../catalog/types'
import type { Size3D, Transform2D, Vec2 } from '../model/types'
import { rotateVec } from '../space'
import { holeRadius } from './bounds'

/**
 * Cm of tablecloth deliberately left visible between the USABLE top's edge and
 * the item — a styling number, and the only part of the inset anyone would ever
 * want to tune. It is not the whole distance from the declared rim: `TOP_INSET`
 * below is added to it, and the two are kept apart so each stays readable for
 * what it is. Exported so tests read it instead of freezing a 3 (BRIEF §1.7).
 */
export const EDGE_INSET = 3

/**
 * How far a table's REAL top is inside the outline the catalog declares for it,
 * per catalog id, in cm at the entry's `defaultSize`.
 *
 * ⚠ THIS IS NOT A FUDGE FACTOR. Every table's `defaultSize` is the bounding box
 * of its GLB, and a draped table's widest point is the HEM near the floor, not
 * the surface. So the outline that `footprint()` reports — the one seats are
 * measured against, and the blue circle the 2D plan draws — is the hem, while
 * the only place a plate can actually stand is 11–19 cm inside it. Laying a
 * place setting `EDGE_INSET` in from the declared rim therefore hangs it over
 * the drape, in the air: that is exactly the reported defect (source doc §3/§23,
 * evidence 11.PNG/12.PNG show a charger past the cloth with daylight under it,
 * 13.PNG shows the same ring crossing the outline in plan).
 *
 * MEASURED, not guessed, 2026-07-29 — and measured TWICE, because the obvious
 * measurement is wrong on two of the six.
 *
 * `tools/glb-prep/measure-top.mjs <file> 1` rasterises the model top-down and
 * reports the silhouette of the top 5% of its height. Subtracting its extents
 * from the declared ones gives a first answer:
 *
 *   table.round        r 90    100% to r=77, 89% @78, 44% @79      ⇒ 12
 *   table.round-large  r 190   100% to r=169, 86% @171, 54% @172   ⇒ 19
 *   table.square       80×80   raw silhouette 67.5 × 67.5          ⇒ 13
 *   table.banquet      120×60  raw silhouette 108.5 × 48.5         ⇒ 12
 *   table.knights-480  240×60  raw silhouette 226.5 × 48.5         ⇒ 14
 *   table.serpentine   band half-width 40: top area 45 666 cm² over a 580.5 cm
 *                      centre line = a 78.7 cm band, i.e. its declared 80 ⇒ 0
 *
 * ⚠ THE RAW SILHOUETTE IS THE TIP OF A FOLD, NOT THE SURFACE. These cloths pool
 * and scallop, so the outermost covered cell on an axis can sit 10 cm outside the
 * last row that is solid all the way along. Sweeping the two long tables row by
 * row: the knights table is 100% covered only to |z| = 35, 99% at 37, 94% at 38,
 * 83% at 40 and 0% by 49 — the "48.5" above is one fold's crest. So the numbers
 * below were then tuned EMPIRICALLY against each model's own top mask: lay a full
 * set of covers, test all four corners of each against the rasterised silhouette,
 * and take the smallest whole-cm inset at which the count of corners hanging over
 * the drape stops falling. Corners off the top, by TOTAL inset (= EDGE_INSET +
 * this map), out of 4 per cover:
 *
 *   table.round        24 corners off at 3 …  0 from 14  ⇒ 12 (+1 cm of margin)
 *   table.round-large  44 off at 3 …  0 from 21          ⇒ 19 (+1 cm)
 *   table.square       24 off at 3 …  8 from 14, floor   ⇒ 13 (+2 cm)
 *   table.banquet      28 off at 3 …  4 at 16, floor     ⇒ 13
 *   table.knights-480  50 off at 3 … 12 at 23, floor     ⇒ 20
 *   table.serpentine    7 off at 3, and an inset does not clear them — see below
 *
 * The two round tables end at zero: every corner of every cover is on the model's
 * own top. The rectangles bottom out above zero and no inset moves them, because
 * the residue is not depth at all — `rectSeats` spreads seats across the FULL
 * declared side length, so the end seats of a run sit past where the drape rounds
 * off at the corner, 4.3 cm past it on the square and 4.8 on the knights. That is
 * the same pre-existing corner defect as the interpenetration in
 * handoff/FOUND-03.md, it is a property of seat ALLOCATION, and it is out of this
 * file's reach: it is recorded here so the floor is never mistaken for a bad inset.
 *
 * The serpentine's 0 is a real finding and not a missing row: its band is modelled
 * edge-to-edge, so it is the one table whose declared width IS its top. Its stray
 * corners are a THIRD cause again — `SERPENTINE_ARCS` is a fitted approximation of
 * a curve whose real width wanders ±5 cm (entries/tables.ts) — so they belong to
 * the fit, not to a hem, and an inset here would only paper over them.
 *
 * ⚠ RE-MEASURED 2026-07-30, and the row above moved: it was 9 stray corners out of
 * 88, and round 4 §15 stopped laying the two HEAD covers, so it is now 7 out of 80.
 * Two of the nine belonged to the heads — which is a finding in itself, since the
 * head covers were dropped for interpenetrating their neighbours and not for
 * hanging off the band. The remaining 7 are unchanged and still belong to the fit.
 *
 * ⚠ RE-PREPPING A TABLE'S GLB INVALIDATES ITS ROW. The numbers are properties of
 * the files in public/props, not of the catalog: change a drape, re-run glb-prep,
 * or swap a model, and the row must be re-measured with the command above.
 *
 * ponytail: the right home for this is an optional `topInset` on `CatalogEntry`,
 * beside `defaultSize`/`modelSize` — it is a measured property of the product,
 * exactly as `modelSize` is, and the 2D plan will want it the moment it draws the
 * usable top rather than the hem. It lives here because `src/core/catalog/types.ts`
 * belongs to another plan. Moving it is three steps: add the field, set the six
 * numbers on the six table entries, and have `tableTopInset()` read
 * `entry.topInset` with this map deleted.
 */
const TOP_INSET: Record<string, number> = {
  'table.round': 12,
  'table.round-large': 19,
  'table.square': 13,
  'table.banquet': 13,
  'table.knights-480': 20,
  'table.serpentine': 0,
}

/**
 * The measured inset for a table, or 0 for anything unmeasured — an unknown table
 * lays exactly as it did before, which is the honest default: inventing an inset
 * for an unmeasured model would move furniture on no evidence.
 */
export function tableTopInset(catalogId: string | undefined): number {
  return catalogId === undefined ? 0 : TOP_INSET[catalogId] ?? 0
}

/**
 * @param seats      chair transforms from computeSeatTransforms (parent-relative)
 * @param chair      the chair's size — its depth sets how far the seat sits out
 * @param item       the item's size — its depth sets how far in from the rim it lands
 * @param seatOffset SeatingConfig.offset: cm from table edge to chair edge
 * @param top        the parent's top outline. Only its HOLE is read — see `clearOfHole`
 * @param tableId    the parent's catalog id, for its measured `TOP_INSET`. Omitted
 *                   means "unmeasured table", i.e. trust the declared outline
 * @param edgeInset  cm of tablecloth left visible between the usable top and the item
 */
export function seatItemTransforms(
  seats: Transform2D[],
  chair: Size3D,
  item: Size3D,
  seatOffset: number,
  top?: Outline,
  tableId?: string,
  edgeInset = EDGE_INSET,
): Transform2D[] {
  // seat centre → item centre, measured along the seat's front. The seat sits
  // (offset + chair.depth/2) outside the DECLARED rim, so those two terms cancel
  // exactly and the item lands (inset + item.depth/2) inside that rim, whatever
  // the table's shape — the chair and the offset do not reach the answer at all.
  // `tableTopInset` is what turns "inside the declared rim" into "inside the top
  // the plate can stand on", which is the whole of this file's fix.
  const inset = edgeInset + tableTopInset(tableId)
  const d = seatOffset + chair.depth / 2 + inset + item.depth / 2
  const hole = top ? holeRadius(top) : 0
  return seats.map((seat) => {
    const front = rotateVec({ x: 0, y: -1 }, seat.rotation)
    // the setting must face the seated guest, i.e. away from the table: the
    // seat's front points in, so the item's is the opposite one
    const rotation = seat.rotation + 180
    const centre = {
      x: seat.position.x + front.x * d,
      y: seat.position.y + front.y * d,
    }
    return {
      position: hole > 0 ? clearOfHole(centre, rotation, item, hole) : centre,
      rotation,
      elevation: 0,
    }
  })
}

/**
 * Source doc §43 — the one thing the seat's frame cannot see.
 *
 * Everything above works in the seat's own frame and is therefore shape-agnostic:
 * the item is pushed in from the rim the seat was measured against, so the OUTER
 * edge takes care of itself on a circle, a rectangle and the serpentine's band
 * alike. A RING has a second edge the seat knows nothing about — the ⌀380's ⌀156
 * opening — and a push that crosses it puts a place setting over the floor.
 *
 * So this is a one-directional guard: push the item back OUT until its whole
 * rotated footprint clears the opening, and never pull it in.
 *
 * Parent-local coordinates, so the ring is centred on the origin and `holeRadius`
 * is the whole of the test — `pointInHole` wants a placed world transform and would
 * only be the same arithmetic with a zero offset added to it.
 *
 * ⚠ Measured, so nobody mistakes this for a repair: at the catalog's numbers it
 * NEVER fires. A cover on the ⌀380 lands at r = 152.35 and its nearest corner at
 * r = 137.88, against a hole of 78 — holding that centre, it would take an item
 * ~149 cm deep to reach the opening. This turns a property that was true by
 * accident into one that is true by construction, and seatItemLayout.test.ts is
 * where the 137.88 is pinned.
 *
 * ⚠ `TOP_INSET` moved both numbers: before it the cover sat at r = 171.35 with its
 * nearest corner at 156.7. The slack SHRANK by 19 cm and is still 60 cm, so the
 * guard is no closer to firing than it was — but that is now a thing the inset can
 * change, which is why the test derives it from `tableTopInset` rather than from a
 * remembered 156.7.
 */
function clearOfHole(p: Vec2, rotation: number, item: Size3D, hole: number): Vec2 {
  const len = Math.hypot(p.x, p.y)
  // dead centre has no radial direction to push along, and is only reachable on a
  // table narrower than the reach it was laid with
  if (len === 0) return p
  // exact support of the rotated rectangle along the radial direction — the same
  // quantity clampToSurface measures, and the reason neither may use a circumradius
  const u = rotateVec({ x: p.x / len, y: p.y / len }, -rotation)
  const minR = hole + (Math.abs(u.x) * item.width + Math.abs(u.y) * item.depth) / 2
  if (len >= minR) return p
  return { x: (p.x / len) * minR, y: (p.y / len) * minR }
}
