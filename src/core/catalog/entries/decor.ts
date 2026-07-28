import type { CatalogEntry } from '../types'

function vegetationEntry(
  id: string,
  labelKey: string,
  /** what the item looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  size: { width: number; depth: number; height: number },
  model: string,
  /** the GLB's own prepped bounds, when `size` is no longer them — see below */
  modelSize: { width: number; depth: number; height: number } | undefined,
  siting?: Pick<CatalogEntry, 'allowedZones' | 'nearWall'>,
): CatalogEntry {
  return {
    id,
    category: 'decor',
    labelKey,
    promptFragment,
    ...siting,
    defaultSize: size,
    resizable: ['width', 'depth', 'height'],
    minSize: { width: 30, depth: 30, height: 80 },
    maxSize: { width: 200, depth: 200, height: 300 },
    materialSlots: [
      { name: 'pot', labelKey: 'pot', defaultColor: '#b8afa3' },
      { name: 'foliage', labelKey: 'foliage', defaultColor: '#5f7f4f' },
    ],
    footprint: (s) => ({
      parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: Math.min(s.width, s.depth) / 2, slot: 'foliage' }],
      outline: { kind: 'rect', w: s.width, h: s.depth },
    }),
    buildMesh: (s) => {
      const potH = s.height * 0.25
      const foliageR = s.width * 0.65
      return [
        { shape: 'cylinder', dims: [s.width * 0.35, s.width * 0.28, potH], offset: [0, potH / 2, 0], slot: 'pot' },
        { shape: 'sphere', dims: [foliageR], offset: [0, potH + (s.height - potH) * 0.55, 0], slot: 'foliage' },
      ]
    },
    model,
    modelSize,
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

/**
 * `plant.potted` is retained so saved projects continue to load as vegetation 1.
 *
 * Catalogued at 1.5× the prepped GLB (corrections document §6: "both vegetation
 * at a scale of 1.5") — the file itself is untouched, so `modelSize` states the
 * bounds glb-prep actually wrote and the loader grows the model to match. Well
 * inside `maxSize` (200 × 200 × 300) at 151.5 × 141.9 × 240.
 *
 * Both plants' `modelSize` is MEASURED, not just declared: the two GLBs were
 * re-read vertex by vertex on 2026-07-28 and match to within 0.4 mm (Draco
 * quantisation). See handoff/FOUND-03.md §A1-1 — and FOUND-02.md §A3-1 for the
 * round-1 case where an entry and its file had silently drifted apart.
 *
 * Source doc §14 puts it in a ring AROUND the pool, and the ring is now a zone in
 * its own right: the user drew it in the SKP as the `ZONE_SAVIV` layer, so the rule
 * below invents no distance at all. `within: 0` means inside that rectangle or
 * touching it — the band IS the drawing. Round 1 left this unwired precisely
 * because the plan's 150cm was an admitted guess about the ring's width
 * (handoff/BLOCKED-03-A2.md §1); the guess has been removed, not answered.
 *
 * Deliberately NOT `zoneKind`. That marks a FIXED STATION, and a station is exempt
 * from the placement rules rather than bound by them: collision.ts returns [] for
 * one before any geometry runs, and actions.ts's `ruled()` drops it from the gate
 * entirely. The plants would then pass through every other object in the hall —
 * the exact inverse of source doc §15.
 *
 * ⚠ What the user actually drew is a RING of four rectangles (72.2 m² —
 * handoff/01c-venue-data.md). venuePacks.ts:145 currently holds the BOUNDING BOX of
 * that ring, straight from the 18:03 import, so on paper it covers the water across
 * x 2579…3839; PLAN-01C has the four rectangles and has not merged them yet. Today's
 * behaviour is still a subset of the truth rather than a false permission: a zone
 * only stops being a no-go for the entry that NAMES it, so `pool` goes on refusing
 * the water and vegetation 1's real allowance is the strip x 3839…3962. When
 * PLAN-01C lands, this same line yields the whole ring with no change here.
 */
export const pottedPlant = vegetationEntry(
  'plant.potted',
  'plant',
  'a large potted green plant',
  { width: 151.5, depth: 141.9, height: 240 },
  '/props/plant-vegetation-1.glb',
  // the prepped file's own bounds — the pre-1.5× defaultSize
  { width: 101, depth: 94.6, height: 160 },
  { allowedZones: [{ kind: 'saviv', within: 0 }] },
)

/**
 * Vegetation 2 has NO siting rule: it stands anywhere on the venue floor.
 *
 * That REVERSES round 1, on purpose — do not read the missing rule as a
 * regression and do not restore it. Source doc §15 read "vegetation 2 goes only
 * against walls" and this entry carried `nearWall: 60` for it. The round-2
 * corrections (§4, 2026-07-28) say the opposite in as many words: "vegetation 2
 * can be placed wherever you want, it has no location restriction." The 60 was
 * the threshold for "touching the wall" under the old instruction; there is no
 * distance to reinstate, because there is no longer a wall rule.
 *
 * The `nearWall` MECHANISM stays — in CatalogEntry, in collision.ts and in the
 * status bar. Nobody asked for it to go, and it is the catalog's only way to say
 * "against a wall". This entry was its only user, so it currently has none.
 *
 * Same ×1.5 as vegetation 1 (corrections document §6), and the same reason for
 * `modelSize`: the GLB is untouched, so it must state its own prepped bounds.
 * 71.25 × 65.7 × 240 — inside `maxSize` (200 × 200 × 300).
 */
export const pottedPlant2 = vegetationEntry(
  'plant.potted-2',
  'plant2',
  'a slim potted green plant',
  { width: 71.25, depth: 65.7, height: 240 },
  '/props/plant-vegetation-2.glb',
  // the prepped file's own bounds — the pre-1.5× defaultSize
  { width: 47.5, depth: 43.8, height: 160 },
)

export const dividerScreen: CatalogEntry = {
  id: 'divider.screen',
  category: 'decor',
  labelKey: 'divider',
  promptFragment: 'a plain freestanding divider screen',
  defaultSize: { width: 180, depth: 6, height: 180 },
  resizable: ['width', 'height'],
  minSize: { width: 60, height: 100 },
  maxSize: { width: 600, height: 300 },
  materialSlots: [{ name: 'panel', labelKey: 'panel', defaultColor: '#d8d2c8' }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, slot: 'panel' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'box', dims: [s.width, s.height, s.depth], offset: [0, s.height / 2, 0], slot: 'panel' },
  ],
}

/**
 * The Tripo model is named "decor-chandelier-crystal" but it is NOT a chandelier:
 * rendering it (2026-07-20) shows an arched brass stand on a weighted disc base
 * carrying a crystal-basket shade — exactly its product shot. So it is a floor
 * object, not a ceiling one (see entries/hanging.ts). The arch leans out along
 * +depth, which is why the footprint is deeper than it is wide.
 * Size = the normalised GLB bounds (`modelSize` below) at 3×; the loader grows
 * the model to `defaultSize` so the plan footprint and the rendered stand stay
 * the same object. It was 2× — the height the real stand reads at (§10 of the
 * corrections document) — until §7 of the same document asked for "another ×1.5
 * on the crystal arc lamp", which applies to the CATALOGUED size, not to the
 * file: 54.4 × 87.4 × 160 → 81.6 × 131.1 × 240, so 2× became 3×. `modelSize` is
 * a property of the file and therefore does not move.
 * The slot colour is the model's measured mean base colour (baked materials, so
 * 2D only).
 */
export const arcLampCrystal: CatalogEntry = {
  id: 'lamp.arc-crystal',
  category: 'decor',
  labelKey: 'lampArcCrystal',
  promptFragment:
    'an arched brass floor lamp with a crystal basket shade on a weighted disc base',
  defaultSize: { width: 81.6, depth: 131.1, height: 240 },
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [{ name: 'body', labelKey: 'body', defaultColor: '#a78c6e' }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'body' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  buildMesh: (s) => [
    { shape: 'cylinder', dims: [s.width * 0.45, s.width * 0.45, s.height * 0.04], offset: [0, s.height * 0.02, 0], slot: 'body' },
    { shape: 'cylinder', dims: [s.width * 0.05, s.width * 0.05, s.height], offset: [0, s.height / 2, 0], slot: 'body' },
    { shape: 'cylinder', dims: [s.width * 0.3, s.width * 0.45, s.height * 0.3], offset: [0, s.height * 0.7, s.depth * 0.3], slot: 'body' },
  ],
  model: '/props/decor-chandelier-crystal.glb',
  modelSize: { width: 27.2, depth: 43.7, height: 80 },
  thumbnail: '/thumbs/lamp-arc-crystal.webp',
}

export const decorEntries = [pottedPlant, pottedPlant2, dividerScreen, arcLampCrystal]
