/**
 * Bars, the DJ stand and the buffet table.
 *
 * ‼ `bar.straight` WAS HERE AND IS RETIRED (2026-07-28, user-approved — see
 * handoff/BLOCKED-1B.md). It described itself as "a 5.8m double bar counter with a
 * full-height bottle display wall behind it", and its thumbnail showed exactly
 * that: two butted counters with a slatted display wall. In other words it was
 * this same physical bar before it was re-modelled as the three separate pieces
 * below, and keeping both would have meant four catalog entries for one real bar.
 *
 * Retiring an id is not free: `getCatalogEntry` throws on an unknown one, so a
 * stored object that outlived its entry is a project that will not open. The
 * v9→v10 migration converts every stored `bar.straight` and is written to be
 * exhaustive for that reason. Do NOT re-add the id, and do not delete the
 * migration.
 *
 * `public/props/bar-straight.glb` stays on disk. It is what the migration's own
 * comment describes and the only record of the pre-split model; nothing references
 * it, so it costs a file and no load time.
 */
import type { CatalogEntry } from '../types'

const P = (file: string) => `/props/${file}`

/** cm, at the 0.1 the source measurements carry — scaling in binary floats drifts */
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * `dj-resort.glb`'s OWN measured bounds. A property of the FILE, so it does not
 * move when the catalogued size does — which is the whole point of `modelSize`
 * (catalog/types.ts:152-168).
 */
const DJ_BOOTH_MODEL_SIZE = { width: 309.9, depth: 242.9, height: 183.8 }

/**
 * "Shrink the DJ stand by 0.7" — round-3 correction §1. Stated as a factor over
 * the model's own size rather than as three literals, so the one number the user
 * gave is the one number in the file and `defaultSize` cannot drift away from the
 * bounds it is a fraction of.
 */
const DJ_BOOTH_SCALE = 0.7

/**
 * Library search words shared by the three pieces of the resort's bar. Singular
 * and short — matching is by substring over normalised text (ui/librarySearch.ts).
 * The DJ stand and the buffet are different objects and carry their own lists.
 */
const BAR_KEYWORDS = ['בר', 'דלפק', 'שתייה', 'עמדה', 'אלכוהול']

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
  keywords: [...BAR_KEYWORDS, 'שמאל'],
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
  keywords: [...BAR_KEYWORDS, 'ימין'],
  model: P('bar-resort-right.glb'),
  thumbnail: '/thumbs/bar-resort-right.webp',
}

/** The "ANKO BAR" shelving unit that stands behind the counters, against the wall. */
export const barBackWall: CatalogEntry = {
  id: 'bar.back-wall',
  category: 'bars',
  labelKey: 'barBackWall',
  promptFragment: 'a tall open oak shelving unit used as the back wall of a bar',
  keywords: [...BAR_KEYWORDS, 'מדף', 'ארון', 'גב'],
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
  // 'dj' is in the id and the label already; these are the words a Hebrew speaker
  // types instead. The gershayim in 'דיג׳יי' is stripped before matching.
  keywords: ['דיג׳יי', 'תקליטן', 'מוזיקה', 'עמדה', 'הגברה'],
  // 2026-07-28: re-modelled. `dj-resort.glb` REPLACES `dj-booth.glb` on this same
  // entry rather than arriving as a second one, because it is the same physical
  // stand: this entry's thumbnail is already DJ2.png, the reference the user named
  // in §36, and that photo is the gold mesh trapezoid with the wood top and the
  // Gamos "G" medallion that the new model carries. One product, one entry
  // (REAL-INVENTORY, presets.ts:7-9).
  //
  // 2026-07-29: SHRUNK TO 0.7 at the user's request (round-3 correction §1).
  //
  // The model still measures 309.9 × 242.9 × 183.8 — that is what the file holds
  // and it did not move, which is why those numbers are now `modelSize` rather
  // than gone. The catalogue states 0.7 of them, so the loader's per-axis fit
  // `size / (modelSize ?? defaultSize)` comes out at 0.7 instead of 1 and the
  // model is drawn at the size 2D draws. ⚠ Dropping `modelSize` would make the
  // ratio 1 again and the stand would silently stay full-size in 3D only.
  //
  // The consequence, stated plainly: the stand NO LONGER FILLS ITS ZONE. It used
  // to match ZONE_DJ (310 × 243) to within a millimetre, and source doc §37
  // ("check it is at the plan's dimensions, and only scale if not") resolved to
  // "do not scale". The newer instruction overrides that — at 216.9 × 170 the
  // booth leaves ~93 cm across and ~73 cm of depth of its rectangle free.
  //
  // A saved project keeps its stored size, so it needs a migration to follow the
  // catalogue: v9→v10 already rewrote the pre-re-model 208×91×143, and v10→v11
  // (migrations/index.ts) rewrites the full-size 309.9×242.9×183.8 to this.
  defaultSize: {
    width: round1(DJ_BOOTH_MODEL_SIZE.width * DJ_BOOTH_SCALE),
    depth: round1(DJ_BOOTH_MODEL_SIZE.depth * DJ_BOOTH_SCALE),
    height: round1(DJ_BOOTH_MODEL_SIZE.height * DJ_BOOTH_SCALE),
  },
  modelSize: DJ_BOOTH_MODEL_SIZE,
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
  // the venue's real DJ stand — prepped at its own bounds, catalogued at 0.7 of them
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

/**
 * The resort's wheeled catering counter — real at last. Round 4 closes the oldest
 * open item in the catalogue: `buffet.table` and `divider.screen` were the only
 * two entries with no GLB and no photo, asked about in round 1
 * (Plans/R1/handoff/BLOCKED-01-A1.md) and never answered until the user supplied
 * `בופה ריזורט.glb` + `בופה ריזורט.png`.
 *
 * ⚠ THE ID MUST STAY `buffet.table`. It is named by
 * `ALLOWED_IN_KABALAT_PANIM` (layout/collision.ts:432) and locked by
 * collision.test.ts — a buffet is one of the three things allowed on the
 * reception deck. Renaming it to match the new model would silently drop that
 * permission and make every saved project unopenable (`getCatalogEntry` throws).
 *
 * ⚠ `בופה אולם.glb` IS A DIFFERENT PRODUCT and is deliberately NOT here. It is
 * the HALL's built-in buffet; this project is resort-only, so it does not enter
 * the catalogue (REAL-INVENTORY, presets.ts:7-9).
 *
 * SIZE — prepped uniformly to a stated 185 cm total height and catalogued at the
 * bounds glb-prep printed, 180.5 × 83.1 × 185. Height is the anchor because it is
 * the only dimension the photo pins: the shot is a three-quarter view on a plain
 * backdrop with nothing of known size beside it, so width and depth can only be
 * read off the model, and they are. Uniform scale, NOT `--footprint` — stretching
 * x and z independently would fatten the canopy posts against the counter.
 *
 * ⚠ THE 185 RESTS ON AN ASSUMPTION THAT MEASURED SLIGHTLY WRONG, and the number
 * is kept anyway. The reasoning was "the stone top reads at ≈49% of the total
 * height in the photo, and a service counter is 90 cm", which gives 90/0.49 ≈ 185.
 * The MODEL's own ratio, measured on the prepped file (the largest up-facing
 * plane sits at y = 84.7 cm of 185), is 45.8% — so the counter lands at 84.7 cm,
 * 5.3 cm below a standard 90 cm counter, and a true 90 would need `--height 196.5`.
 * 185 is what was prepped and what is stated; the day someone wants the counter
 * at exactly 90, re-prep at 196.5 and migrate, the way v10→v11 did for the DJ.
 *
 * No `modelSize` — the file IS at this size, which is the normal case
 * (catalog/types.ts:166).
 *
 * The slot colours are the area-weighted mean of the baked texture, the method
 * recorded at :46-49 and measured here per triangle over world-space area:
 * `counter` from the up-facing triangles in the 82…90 cm band (#4e3826 over
 * 1.445 m² — the brown-and-gold stone slab), `body` from everything that is not
 * that plane (#938370 over 7.045 m² — the taupe fluted case and the canopy).
 * They tint the 2D footprint only; the GLB's materials are baked.
 *
 * Facing verified, not assumed: `model-elevation.mjs --view front` puts its
 * camera on −Z looking toward +Z, and what it renders is the fluted panel with
 * the oval medallion. So the model already faces the app's way and needs no
 * `defaultRotation` (contrast `dj.booth` above, which does).
 */
export const buffetTable: CatalogEntry = {
  id: 'buffet.table',
  category: 'bars',
  labelKey: 'buffet',
  promptFragment:
    'a wheeled catering counter with a dark stone top, a fluted taupe front with an oval medallion, and a tall overhead frame',
  keywords: ['בופה', 'מזנון', 'אוכל', 'הגשה', 'עגלה', 'עמדה'],
  defaultSize: { width: 180.5, depth: 83.1, height: 185 },
  // real inventory: one product, one size. Every other GLB-backed entry does this
  // — a resizable box would stretch the model away from the thing in the store.
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'body', labelKey: 'body', defaultColor: '#938370' },
    { name: 'counter', labelKey: 'counter', defaultColor: '#4e3826' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 4, slot: 'counter' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  // fallback only — the GLB is the real render. Same recipe as `barResortLeft`
  // above: a case with a slab proud of it on every side.
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height - 6, s.depth], offset: [0, (s.height - 6) / 2, 0], slot: 'body' },
    { shape: 'box', dims: [s.width + 8, 6, s.depth + 8], offset: [0, s.height - 3, 0], slot: 'counter' },
  ],
  model: P('buffet-resort.glb'),
  thumbnail: '/thumbs/buffet-table.webp',
  labelByDefault: true,
}

export const barEntries = [barResortLeft, barResortRight, barBackWall, djBooth, buffetTable]
