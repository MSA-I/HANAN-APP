/**
 * The venue's real tables. Sizes are the measured inventory (furniture-library-spec.md
 * §1), and each carries the resort's own Tripo GLB with the linen baked in — so the
 * `cloth`/`legs` slots below only colour the 2D footprint and the procedural fallback.
 *
 * ponytail: the ⌀380 is a separate entry rather than a resize of table.round. Both
 * have their own scanned model and their own seat count (12 vs 22); one resizable
 * entry would stretch the wrong drape over the wrong table.
 */
import { serpentineArcs, serpentineBounds, serpentineSeats } from '../../layout/serpentine'
import type { CatalogEntry } from '../types'
import { leggedTable, pedestalTable } from '../builders'

const CLOTH = { name: 'cloth', labelKey: 'cloth', defaultColor: '#f5f0e8' }
const LEGS = { name: 'legs', labelKey: 'legs', defaultColor: '#a67b5b' }

/** The house chair — what a freshly-dropped table seats until the user picks another. */
const DEFAULT_CHAIR = 'chair.x-white'

export const roundTable: CatalogEntry = {
  id: 'table.round',
  category: 'tables',
  labelKey: 'tableRound',
  defaultSize: { width: 180, depth: 180, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'cloth' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
  // real resort table: "מעוגל-בינוני-ריזורט+אולם-מפה" (Tripo), cloth baked in.
  model: '/props/table-round-180.glb',
  thumbnail: '/thumbs/table-round.webp',
  seating: { min: 0, max: 20, defaultCount: 12, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
  labelByDefault: true,
}

export const roundTableLarge: CatalogEntry = {
  id: 'table.round-large',
  category: 'tables',
  labelKey: 'tableRoundLarge',
  defaultSize: { width: 380, depth: 380, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'circle', r: s.width / 2, slot: 'cloth' }],
    outline: { kind: 'circle', r: s.width / 2 },
  }),
  buildMesh: (s) => pedestalTable(s.width, s.height, 'cloth', 'legs'),
  // real resort table: "מעוגל-גדול-ריזורט+אולם-מפה" (Tripo).
  model: '/props/table-round-380.glb',
  thumbnail: '/thumbs/table-round-large.webp',
  seating: { min: 0, max: 30, defaultCount: 22, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
  labelByDefault: true,
}

export const squareTable: CatalogEntry = {
  id: 'table.square',
  category: 'tables',
  labelKey: 'tableSquare',
  defaultSize: { width: 160, depth: 160, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  linkWidthDepth: true,
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  // real resort table: "מרובע-ריזורט-מפה" (Tripo).
  model: '/props/table-square-160.glb',
  thumbnail: '/thumbs/table-square.webp',
  seating: { min: 0, max: 16, defaultCount: 12, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
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
  defaultSize: { width: 240, depth: 120, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  // real resort table: "מלבן-ריזורט-מפה" (Tripo).
  model: '/props/table-banquet-240.glb',
  thumbnail: '/thumbs/table-banquet.webp',
  seating: { min: 0, max: 40, defaultCount: 12, defaultChair: DEFAULT_CHAIR, defaultGap: 8, defaultOffset: 6 },
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
  defaultSize: { width: 480, depth: 120, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
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
  // = the prepped GLB bbox, verified after prepping: `size [4.22, 0.75, 4.22]` m
  defaultSize: { width: 422, depth: 422, height: 75 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [CLOTH, LEGS],
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
  // 20 = 11 on the long flank + 9 on the short. They differ because the arcs
  // sweep through different angles, so the r+d / r−d offsets do not cancel —
  // see the warning on `edgeLength`. Asserted against the geometry in
  // serpentine.test.ts so the two cannot drift apart.
  seating: { min: 0, max: 20, defaultCount: 20, defaultChair: DEFAULT_CHAIR, defaultGap: 10, defaultOffset: 6 },
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
