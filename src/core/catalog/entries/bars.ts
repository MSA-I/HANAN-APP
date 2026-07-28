/**
 * Bars, the DJ stand and the buffet table.
 *
 * ⛔ REAL-INVENTORY conflict, open — see handoff/BLOCKED-1B.md.
 * `bar.straight` below calls itself "a 5.8m double bar counter with a full-height
 * bottle display wall behind it", and its shipped thumbnail shows exactly that:
 * two butted counters with a slatted display wall behind them. The three resort
 * entries added under it — two counter halves and the back wall — are that same
 * physical bar, re-modelled as separately placeable pieces so the venue fixtures
 * can be baked from them. Four catalog entries, one real bar.
 *
 * `bar.straight` is NOT retired here. Saved projects contain it, and retiring it
 * would silently drop the object from every one of them. Documented and asked.
 */
import type { CatalogEntry } from '../types'
import { leggedTable } from '../builders'

const P = (file: string) => `/props/${file}`

export const barCounter: CatalogEntry = {
  id: 'bar.straight',
  category: 'bars',
  labelKey: 'bar',
  promptFragment: 'a 5.8m double bar counter with a full-height bottle display wall behind it',
  // THE resort bar station, sized from the user's real-bar photo (2026-07-19):
  // two joined counter units (~290 each → 580 total) PLUS the display wall
  // behind them — the wall is part of the bar (user-confirmed), so `height` is
  // the WALL top (237); the counter top lands at ~112 (fp-height was computed
  // counter-first: 112 / (counterRaw 0.204 / totalRaw 0.431) ≈ 237). Fits the
  // 800×300 bar zone. Photo-derived — tape measurements welcome.
  defaultSize: { width: 580, depth: 80, height: 237 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#5c5148' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#d9d2c7' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'counter' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    // loading fallback mirrors the GLB: counter at the front, display wall behind
    { shape: 'box', dims: [s.width, 108, 62], offset: [0, 54, s.depth / 2 - 31], slot: 'body' },
    { shape: 'box', dims: [s.width + 10, 4, 68], offset: [0, 110, s.depth / 2 - 31], slot: 'counter' },
    { shape: 'box', dims: [s.width, s.height, 8], offset: [0, s.height / 2, -s.depth / 2 + 4], slot: 'body' },
  ],
  // real resort bar: "בר+ריזורט" (Tripo), re-prepped to the station size above.
  model: '/props/bar-straight.glb',
  thumbnail: '/thumbs/bar-straight.webp',
  // fixed station — lives only inside the venue's bar zone
  zoneKind: 'bar',
  labelByDefault: true,
}

/**
 * The resort's own bar, as three separately placeable pieces. Sizes are the EXACT
 * prepped bounds of each GLB (measured per vertex, not read off a glb-prep log),
 * and the slot colours are the area-weighted mean of each baked texture — the same
 * method that produced every other colour in the catalogue, re-validated against a
 * committed entry before use.
 *
 * These exist so the arrangement can be BAKED into venueFixtures.ts: you place the
 * pieces, press the toolbar's bake button, and the numbers come from the system
 * rather than from an estimate. They carry `zoneKind: 'bar'` so placement snaps
 * them into ZONE_BAR while that is being done.
 *
 * ⚠ They are also, unavoidably, library items the user can keep dropping — a fixed
 * venue fitting is not something anyone should place twice. There is no
 * hide-from-library flag on CatalogEntry and one was NOT invented here; see
 * handoff/BLOCKED-1B.md, which asks for the decision.
 */
export const barResortLeft: CatalogEntry = {
  id: 'bar.resort-left',
  category: 'bars',
  labelKey: 'barResortLeft',
  promptFragment: 'an L-shaped mobile bar counter, cream stone top over a fluted beige front in a black frame',
  defaultSize: { width: 259.8, depth: 139.5, height: 157 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#91877d' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#d9d2c7' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'counter' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 6, s.depth], offset: [0, (s.height - 6) / 2, 0], slot: 'body' },
    { shape: 'box', dims: [s.width + 8, 6, s.depth + 8], offset: [0, s.height - 3, 0], slot: 'counter' },
  ],
  model: P('bar-resort-left.glb'),
  thumbnail: '/thumbs/bar-resort-left.webp',
  zoneKind: 'bar',
  labelByDefault: true,
}

/**
 * The MIRROR of the left half — one product, two hands, which is why both point at
 * the same product photo. Verified as a true mirror rather than a re-export: the
 * two GLBs carry an identical triangle count (78,247), a world surface area equal
 * to four decimal places, and the same measured slot colour.
 */
export const barResortRight: CatalogEntry = {
  ...barResortLeft,
  id: 'bar.resort-right',
  labelKey: 'barResortRight',
  model: P('bar-resort-right.glb'),
  thumbnail: '/thumbs/bar-resort-right.webp',
}

/** The "ANKO BAR" shelving unit that stands behind the counters, against the wall. */
export const barBackWall: CatalogEntry = {
  id: 'bar.back-wall',
  category: 'bars',
  labelKey: 'barBackWall',
  promptFragment: 'a tall open oak shelving unit used as the back wall of a bar',
  defaultSize: { width: 188.9, depth: 85.9, height: 240 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#a08769' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'body' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height, s.depth], offset: [0, s.height / 2, 0], slot: 'body' },
  ],
  model: P('bar-back-wall.glb'),
  thumbnail: '/thumbs/bar-back-wall.webp',
  zoneKind: 'bar',
  labelByDefault: true,
}

export const djBooth: CatalogEntry = {
  id: 'dj.booth',
  category: 'bars',
  labelKey: 'djBooth',
  promptFragment: 'a dark DJ booth',
  // 2026-07-28: re-modelled. `dj-resort.glb` REPLACES `dj-booth.glb` on this same
  // entry rather than arriving as a second one, because it is the same physical
  // stand: this entry's thumbnail is already DJ2.png, the reference the user named
  // in §36, and that photo is the gold mesh trapezoid with the wood top and the
  // Gamos "G" medallion that the new model carries. One product, one entry
  // (REAL-INVENTORY, presets.ts:7-9).
  //
  // The size is now the GLB's own exact bounds, so the loader's scale is 1 and
  // `modelSize` is gone. Those bounds are 309.91 × 242.92, which is ZONE_DJ
  // (310 × 243) to within a millimetre — the model was built to the zone, so
  // source doc §37 ("check it is at the plan's dimensions, and only scale if not")
  // resolves to: do not scale.
  //
  // ⚠ A saved project that already holds a dj.booth keeps its stored 208×91×143
  // and would draw the new model squashed to 0.37 on depth, because propModel
  // scales per axis by size / (modelSize ?? defaultSize). Resizing those objects
  // needs a migration, which this task is not permitted to add — see
  // handoff/BLOCKED-1B.md.
  defaultSize: { width: 309.9, depth: 242.9, height: 183.8 },
  defaultRotation: -180,
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#35312e' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#57534e' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'body' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 4, s.depth], offset: [0, (s.height - 4) / 2, 0], slot: 'body' },
    { shape: 'box', dims: [s.width + 8, 4, s.depth + 8], offset: [0, s.height - 2, 0], slot: 'counter' },
  ],
  // the venue's real DJ stand, prepped to fill ZONE_DJ exactly
  model: P('dj-resort.glb'),
  thumbnail: '/thumbs/dj-booth.webp',
  // fixed station — lives only inside the venue's DJ zone
  zoneKind: 'dj',
  // The venue has TWO alternative DJ positions and only one stand to put in them
  // (ANSWERS-WAVE-1 §3). The nearest-rectangle clamp that picks between them is
  // already in place (actions.ts:348-382); this is the half that stops a second
  // stand being added at all, and it is what PLAN-06 needs from this file.
  // Matches how all eight chuppot share `unique: 'chuppah'`.
  unique: 'dj',
}

export const buffetTable: CatalogEntry = {
  id: 'buffet.table',
  category: 'bars',
  labelKey: 'buffet',
  promptFragment: 'a long draped buffet table',
  defaultSize: { width: 240, depth: 76, height: 90 },
  resizable: ['width'],
  minSize: { width: 120 },
  maxSize: { width: 600 },
  materialSlots: [
    { name: 'cloth', labelKey: 'cloth', defaultColor: '#efe9df' },
    { name: 'legs', labelKey: 'legs', defaultColor: '#a67b5b' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'cloth' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => leggedTable(s.width, s.depth, s.height, 'cloth', 'legs'),
  labelByDefault: true,
}

export const barEntries = [
  barCounter,
  barResortLeft,
  barResortRight,
  barBackWall,
  djBooth,
  buffetTable,
]
