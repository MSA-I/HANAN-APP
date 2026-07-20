/**
 * The venue's real tables. Sizes are the measured inventory (furniture-library-spec.md
 * §1), and each carries the resort's own Tripo GLB with the linen baked in — so the
 * `cloth`/`legs` slots below only colour the 2D footprint and the procedural fallback.
 *
 * ponytail: the ⌀380 is a separate entry rather than a resize of table.round. Both
 * have their own scanned model and their own seat count (12 vs 22); one resizable
 * entry would stretch the wrong drape over the wrong table.
 */
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
 * No `model` — table-banquet-240.glb stretched 2× would stretch its baked drape folds
 * with it, so this one falls back to the procedural `leggedTable`. No `thumbnail`
 * either: the library then draws the footprint below, and the two butted rects read as
 * the joined table they are.
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
  seating: { min: 0, max: 22, defaultCount: 22, defaultChair: DEFAULT_CHAIR, defaultGap: 8, defaultOffset: 6 },
  labelByDefault: true,
}

// table.rect (180×90) and table.cocktail (⌀70) were generic placeholders with no
// counterpart in the venue's inventory and no scanned model — they would have gone
// into an AI frame as invented grey furniture. Dropped; migration v1→v2 remaps any
// stored ones onto the real tables.
export const tableEntries = [roundTable, roundTableLarge, squareTable, banquetTable, knightsTable]
