/**
 * The venue's real tables. Sizes are the measured inventory (furniture-library-spec.md
 * §1), and each carries the resort's own Tripo GLB with the linen baked in — so the
 * `cloth`/`legs` slots below only colour the 2D footprint and the procedural fallback.
 *
 * ponytail: the ⌀380 is a separate entry rather than a resize of table.round. Both
 * have their own scanned model and their own seat count (12 vs 22); one resizable
 * entry would stretch the wrong drape over the wrong table.
 */
import {
  serpentineArcs,
  serpentineBounds,
  serpentineSeatItemSeats,
  serpentineSeats,
} from '../../layout/serpentine'
import type { CatalogEntry } from '../types'
import { leggedTable, pedestalTable } from '../builders'

const CLOTH = { name: 'cloth', labelKey: 'cloth', defaultColor: '#f5f0e8' }
const LEGS = { name: 'legs', labelKey: 'legs', defaultColor: '#a67b5b' }

/**
 * What every table in the family answers to in the library search, whatever its
 * shape. Singular and short, because matching is by SUBSTRING over normalised
 * text (ui/librarySearch.ts) — 'שולחן' already finds 'שולחנות'; each entry adds
 * the words for its own shape.
 *
 * These six are the one family in the catalogue written out rather than built by
 * a factory, so like `librarySubtitle` above the constant has to be spread by
 * hand into each. A seventh table that forgets it is still findable by its label.
 */
const TABLE_KEYWORDS = ['שולחן', 'אירוח']

/** The house chair — what a freshly-dropped table seats until the user picks another. */
const DEFAULT_CHAIR = 'chair.x-white'

/**
 * Source doc §20: "the tables need a description of the number of chairs". Every
 * entry below carries `librarySubtitle: 'seats'`, so its library tile prints
 * `seating.defaultCount` in place of the footprint — the number that decides
 * which table a party of 90 needs, where the diameter does not.
 *
 * Unlike every other family in the catalogue these six are written out rather
 * than built by a shared factory, so the field is repeated per entry. A seventh
 * table that forgets it would silently fall back to printing its size; that is
 * what catalog/librarySubtitle.test.ts sweeps for.
 *
 * ⚠ `editableSlots: [{ slot: 'cloth', texture: true }]` — WITH NO `defaultTexture`,
 * on all six, and that absence is the whole of round 4 §8. Every table used to be
 * registered in `viewer3d/slotTextures.ts` for `fabric-06`, so a freshly dropped
 * table arrived wearing a cream damask trellis nobody had chosen: "it also loads a
 * tablecloth texture automatically, when it should load on white by default". With
 * the row gone and no default here, `ModelParts` builds no material override at all
 * and the GLB's own baked drape renders untouched — the plain white the request
 * asks for is the model as modelled, not a flat colour painted over it. `fabric-06`
 * is still one click away in the picker. Locked in catalog/editableSlots.test.ts,
 * which fails if any table ever declares a `defaultTexture` again.
 */

export const roundTable: CatalogEntry = {
  id: 'table.round',
  category: 'tables',
  labelKey: 'tableRound',
  promptFragment: 'a 180cm round banquet table under a floor-length tablecloth',
  keywords: [...TABLE_KEYWORDS, 'עגול'],
  defaultSize: { width: 180, depth: 180, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'cloth' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
  // real resort table: "מעוגל-בינוני-ריזורט+אולם-מפה" (Tripo), cloth baked in.
  model: '/props/table-round-180.glb',
  thumbnail: '/thumbs/table-round.webp',
  seating: { min: 0, max: 20, defaultCount: 12, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

/**
 * The ⌀380 is a RING, not a disc: it has a real ⌀156 hole through its top, which
 * the user fills with a standing centrepiece.
 *
 * Measured, not guessed — `table-round-380.glb` rasterised top-down at 1cm and
 * sliced by height. Radial coverage of the table top is 0% out to r=76, 10% at
 * 77, 59% at 78, 91% at 79 and 100% from r=80: the edge crosses 50% at r≈77.9,
 * so the hole is r=78. (The ⌀180 was measured the same way and is solid, so this
 * is a property of this table, not of round tables.)
 *
 * Stored as a ratio of the width so the hole tracks the table if it is ever
 * resized. The entry is `resizable: []` today, so it always evaluates to 78.
 */
const ROUND_LARGE_HOLE_RATIO = 78 / 380

export const roundTableLarge: CatalogEntry = {
  id: 'table.round-large',
  category: 'tables',
  labelKey: 'tableRoundLarge',
  promptFragment: 'a 380cm round banquet table with an open centre well, under a floor-length tablecloth',
  // 'חור' and 'טבעת' because the open centre is what people call this one by
  keywords: [...TABLE_KEYWORDS, 'עגול', 'גדול', 'חור', 'טבעת'],
  defaultSize: { width: 380, depth: 380, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  footprint: (s) => {
    const rInner = s.width * ROUND_LARGE_HOLE_RATIO
    return {
      parts: [{ kind: 'circle', r: s.width / 2, rInner, slot: 'cloth' }],
      outline: { kind: 'circle', r: s.width / 2, rInner },
    }
  },
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
  // real resort table: "מעוגל-גדול-ריזורט+אולם-מפה" (Tripo).
  model: '/props/table-round-380.glb',
  thumbnail: '/thumbs/table-round-large.webp',
  seating: { min: 0, max: 30, defaultCount: 22, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

/**
 * `defaultCount: 10` is the user's call (corrections document §48: "the default
 * for chairs on the square table will be 10"), not a capacity limit — the table
 * still SEATS 12. It is a comfort choice: 10 leaves elbow room on a 160 side.
 *
 * ⚠ `defaultGap: 8` is load-bearing all the same, exactly as on the knights
 * table. Capacity is 4·⌊160/(45+gap)⌋: 4·3 = 12 at gap 8, but 4·2 = 8 at gap 9 —
 * 160 takes three 53cm units with 1cm to spare and only two 54cm ones. There is
 * no middle value; it falls straight from 12 to 8. So the inspector's gap cap
 * (maxGapForSeats: the largest gap that still seats `defaultCount`) is still 8
 * even at a target of 10, and the field still cannot silently delete chairs.
 * Covered in seatLayout.test.ts.
 */
export const squareTable: CatalogEntry = {
  id: 'table.square',
  category: 'tables',
  labelKey: 'tableSquare',
  promptFragment: 'a 160cm square banquet table under a floor-length tablecloth',
  keywords: [...TABLE_KEYWORDS, 'מרובע', 'ריבוע'],
  defaultSize: { width: 160, depth: 160, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  // real resort table: "מרובע-ריזורט-מפה" (Tripo).
  model: '/props/table-square-160.glb',
  thumbnail: '/thumbs/table-square.webp',
  seating: { min: 0, max: 16, defaultCount: 10, defaultChair: DEFAULT_CHAIR, defaultGap: 8, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

/**
 * "שולחן אבירים" — the 120×240 rectangle. Per the user, these are BUTTED END-TO-END
 * to build a longer table, so the model must tile: its length is prepped to exactly
 * 240cm and the drape stops at the edge. Not resizable for that reason — a stretched
 * 300cm one would not line up with its neighbour.
 */
export const banquetTable: CatalogEntry = {
  id: 'table.banquet',
  category: 'tables',
  labelKey: 'tableBanquet',
  promptFragment: 'a 240 by 120cm rectangular banquet table under a floor-length tablecloth',
  keywords: [...TABLE_KEYWORDS, 'מלבני', 'ארוך'],
  defaultSize: { width: 240, depth: 120, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  // real resort table: "מלבן-ריזורט-מפה" (Tripo).
  model: '/props/table-banquet-240.glb',
  thumbnail: '/thumbs/table-banquet.webp',
  seating: { min: 0, max: 40, defaultCount: 12, defaultChair: DEFAULT_CHAIR, defaultGap: 8, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

/**
 * The same "שולחן אבירים" already butted end-to-end into one 480cm unit — the venue
 * counts it as a single item of inventory, so it is its own entry rather than two
 * table.banquet objects the user has to align by hand. Fixed size for the same reason
 * as its half: the join only lands where the real tables meet.
 *
 * Has its own dedicated GLB (two draped sections modelled as one, seam included) —
 * NOT a stretched table-banquet-240.glb, which would stretch its baked drape folds.
 *
 * ⚠ `defaultGap: 8` is load-bearing, not cosmetic. Capacity is
 * 2·⌊480/(45+gap)⌋ + 2·⌊120/(45+gap)⌋, which is 2·9 + 2·2 = 22 at gap 8 but drops to
 * 2·8 + 2·2 = 20 at gap 9 — only 3.3cm of slack. The inspector exposes gap as an
 * editable 0–60 field, so a user nudging it up makes `reconcileSeats` silently delete
 * two chairs. Covered by the gap-9 regression test in seatLayout.test.ts.
 */
export const knightsTable: CatalogEntry = {
  id: 'table.knights-480',
  category: 'tables',
  labelKey: 'tableKnights',
  promptFragment: 'a 480 by 120cm long banquet table under a floor-length tablecloth',
  keywords: [...TABLE_KEYWORDS, 'מלבני', 'אבירים', 'ארוך'],
  defaultSize: { width: 480, depth: 120, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  footprint: (s) => ({
    // two halves drawn separately so the join between the butted tables shows
    parts: [
      { kind: 'rect', w: s.width / 2, h: s.depth, cx: -s.width / 4, cornerRadius: 2, slot: 'cloth' },
      { kind: 'rect', w: s.width / 2, h: s.depth, cx: s.width / 4, cornerRadius: 2, slot: 'cloth' },
    ],
    // seats, snapping and selection see one table, not two
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  // dedicated double-table scan: "שולחן אבירים" (Tripo), cloth baked in.
  model: '/props/table-knights-480.glb',
  thumbnail: '/thumbs/table-knights-480.webp',
  seating: { min: 0, max: 22, defaultCount: 22, defaultChair: DEFAULT_CHAIR, defaultGap: 8, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

/**
 * "שולחן נחש" — the S-curved band. The only table in the catalog whose seat line
 * is neither a circle nor a rectangle, so it carries a `seats` function instead
 * of relying on its `outline` (see core/layout/serpentine.ts for why that beats a
 * third `Outline` variant).
 *
 * ⚠ TWO THINGS HERE LOOK LIKE BUGS AND ARE NOT. Read before "fixing" the size.
 *
 * 1. This table's plan footprint is 4.22 × 4.22 m — LARGER than the ⌀380 round,
 *    and the biggest item in the catalog. That is the direct consequence of
 *    honouring the real table's 80 cm width on this particular model.
 * 2. The Tripo model's band-to-length ratio is about 1:7; the real table is
 *    80 × 300, which is 1:3.75. No uniform scale satisfies both, so the on-screen
 *    curve is longer and more sweeping than the physical table. Width won,
 *    because width is what decides whether people can eat at it. The width and
 *    the seat capacity are right; the overall length is the model's, not the
 *    inventory's.
 *
 * Measured on the prepped GLB (`--footprint 422x422 --fp-height 75`): band width
 * median 80.0 (range 75…85 — the drape flares, so it is not perfectly constant),
 * centre line 580.5 cm, bbox 422 × 75 × 422.
 *
 * `defaultSize` is the prepped GLB's own bbox, so the 3D model renders unscaled.
 * `serpentineBounds()` returns the origin-centred box of the fitted arcs. It is
 * a few centimetres larger on one axis, so the outline takes the larger value
 * per axis and remains genuinely conservative.
 *
 * Seat count follows available space rather than a target, which is what the
 * user asked for.
 */
export const serpentineTable: CatalogEntry = {
  id: 'table.serpentine',
  category: 'tables',
  labelKey: 'tableSerpentine',
  promptFragment: 'a serpentine S-curved banquet table, an 80cm-wide draped band',
  keywords: [...TABLE_KEYWORDS, 'נחש', 'גלי', 'מתעגל'],
  // = the prepped GLB bbox, verified after prepping: `size [4.22, 0.75, 4.22]` m
  defaultSize: { width: 422, depth: 422, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
  editableSlots: [{ slot: 'cloth', texture: true }],
  /**
   * The user's number, chosen 2026-08-02 from the PLAN-07 §2 measurement.
   *
   * The serpentine is a curved band, so neither of the two words source doc §37-38
   * uses fits it, and the 170 it used to inherit came from its `outline: rect` —
   * a shape it declares for snapping and hit-testing, not because anybody decided
   * its aisle. What the measurement showed is that the aisle the RULE measures and
   * the aisle a guest WALKS DOWN are different numbers here: the chairs stand
   * 250.5 cm from the centre while the drape reaches only ~211. At 170 the real
   * chair-back-to-chair-back walkway beside a ⌀180 was 31.5 cm; at 160 it is 20.5,
   * against the 18.0 the app already allows between two ⌀180 round tables. Below
   * 140 the walkway goes negative and chair-to-chair collision refuses anyway, so
   * anything at or under ~87 cm could not change a single placement.
   */
  clearance: 160,
  footprint: (s) => {
    const band = serpentineBounds()
    return {
      parts: serpentineArcs().map((a) => ({ kind: 'arc' as const, ...a, slot: 'cloth' })),
      // Use the larger of the measured GLB and the fitted band's centred box.
      outline: { kind: 'rect', w: Math.max(s.width, band.width), h: Math.max(s.depth, band.depth) },
    }
  },
  // fallback only, for the moment before the GLB loads and if it fails: a plain
  // box, deliberately NOT an arc mesh — the GLB is the real render, and a second
  // curved-band implementation in 3D would be a second thing to keep in sync
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  model: '/props/table-serpentine.glb',
  thumbnail: '/thumbs/table-serpentine.webp',
  seats: serpentineSeats,
  // …and the two heads take a CHAIR but not a COVER (round 4 §15, the user's own
  // call). By index, from the same `capacities()` the seat walk divides — see
  // `serpentineSeatItemSeats`, which explains why "the last two" would be wrong.
  //
  // ⚠ The inspector then reads "20 מתוך 22 מקומות", and that is CORRECT, not an
  // off-by-two to be tidied away: 22 seats, 20 of them set. The string was written
  // for exactly this shape.
  seatItemSeats: serpentineSeatItemSeats,
  // 22 = 11 on the long flank + 9 on the short + one at each head of the S.
  // The flanks differ because the arcs sweep through different angles, so the
  // r+d / r−d offsets do not cancel — see the warning on `edgeLength`. The two
  // heads sit past the band's end caps, which the flank walk never reaches.
  //
  // ⚠ Re-measured: `capacities()` returns [11, 9] at these defaults, so
  // `serpentineMaxSeats` DOES reach the 22 declared here — 22 is not an
  // aspirational ceiling the math falls short of, whatever a passing reading of
  // `floor(edgeLength / (width + gap))` suggests. serpentine.test.ts derives the
  // split from the same lengths rather than repeating this comment's numbers, and
  // asserts both `max` and `defaultCount` against the geometry, so a chair-size,
  // gap or offset change that broke the 22 fails there instead of silently seating
  // 20. Measured slack, unlike the square and knights tables where a single cm of
  // gap costs chairs: capacity holds 22 from gap 9 through 12 and drops to 21 at
  // 13, so `maxGapForSeats` caps the inspector's field at 12. The offset does not
  // move the total at all over 0…20 — what it adds to the long flank it takes off
  // the short one.
  //
  // The two head PLACE SETTINGS used to overlap their flank neighbours by 12…15cm,
  // and no number on this line could fix it — it was a position defect, not a count
  // one, and no position inside the band clears it (the sweep is on `HEAD_SEATS` in
  // layout/serpentine.ts). Round 4 §15 settled it the other way: the heads keep
  // their chairs and give up their covers, which is `seatItemSeats` above. All 22
  // chairs below are still laid.
  seating: { min: 0, max: 22, defaultCount: 22, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
  librarySubtitle: 'seats',
  labelByDefault: true,
}

// table.rect (180×90) and table.cocktail (⌀70) were generic placeholders with no
// counterpart in the venue's inventory and no scanned model — they would have gone
// into an AI frame as invented grey furniture. Dropped; migration v1→v2 remaps any
// stored ones onto the real tables.
export const tableEntries = [
  roundTable,
  roundTableLarge,
  squareTable,
  banquetTable,
  knightsTable,
  serpentineTable,
]
