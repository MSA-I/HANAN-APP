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
 * ROUND 3 RE-VERIFIED THIS AND FOUND NOTHING TO BUILD (source doc §6, "vegetation
 * 2 can be placed wherever you want, it has no location restriction"): headless,
 * in the resort, it drops in the open floor and hard against the north wall alike
 * (2026-07-29). What it is NOT is `placeAnywhere` — the pool still refuses it, as
 * it refuses a table. "Has no siting rule of its own" and "is exempt from the
 * room's" are different claims and only the first was ever made; the second
 * belongs to the human figure below. Locked in collision.test.ts.
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

/**
 * The mobile room divider — real at last, the other half of round 4's asset
 * closure (see entries/bars.ts's `buffetTable` for the same story). It arrived as
 * `מחיצה.glb` + `מחיצה.png`, and both show one product: a beige pleated curtain
 * hung in a black steel frame that rolls on four casters.
 *
 * SIZE — prepped uniformly to a stated 180 cm total height and catalogued at the
 * bounds glb-prep printed, 155.9 × 31.9 × 180. As with the buffet, height is the
 * only dimension the product shot pins; the rest is read off the model. Uniform
 * scale, NOT `--footprint`: the frame is 31.9 cm deep only because of the two
 * T-shaped feet, and stretching z to hit a footprint would splay them away from
 * a curtain that did not move with them. No `modelSize` — the file is at this
 * size.
 *
 * The panel already spans X and is thin in Z, which is the app's front
 * convention, so no `--yaw` and no `defaultRotation`; verified by rendering the
 * prepped file from the front (`model-elevation.mjs --view front`, camera on −Z)
 * and getting the curtain face rather than an edge.
 *
 * TWO SLOTS, and the split is measured rather than declared. Tripo segmented this
 * model into 25 materials — `Material_tripo_part_0…24` — and the area-weighted
 * mean of the baked texture separates them into exactly two populations: the
 * seventeen curtain pleats and their header average #b7a595 over 7.00 m², and the
 * eight frame parts (rail, two posts, foot bars, four casters) average #3f3d3b
 * over 0.75 m². Nothing sits between the two.
 *
 * ⚠ Agent A2 adds `editableSlots: [{ slot: 'fabric', match: 'fabric', texture:
 * true }]` to this entry in the same round, so the curtain can take a fabric
 * texture. Do not add it here. Note for whoever writes it: NO material in this
 * GLB is named 'fabric' — they are all `Material_tripo_part_N` — so a name match
 * has to be against that list, or the sixteen pleat materials will not be found.
 */
export const dividerScreen: CatalogEntry = {
  id: 'divider.screen',
  category: 'decor',
  labelKey: 'divider',
  promptFragment: 'a mobile room divider — a beige pleated curtain in a black wheeled frame',
  defaultSize: { width: 155.9, depth: 31.9, height: 180 },
  // real inventory: one product, one size, like every other GLB-backed entry
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [
    { name: 'fabric', labelKey: 'fabric', defaultColor: '#b7a595' },
    { name: 'frame', labelKey: 'frame', defaultColor: '#3f3d3b' },
  ],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, slot: 'fabric' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  // fallback only — the GLB is the real render. The curtain as a thin panel, the
  // frame as the two posts and the rail that actually carry it.
  buildMesh: (s) => {
    const post = 5
    const rail = 6
    return [
      { shape: 'box', dims: [s.width - post * 2, s.height - rail, 3], offset: [0, (s.height - rail) / 2, 0], slot: 'fabric' },
      { shape: 'box', dims: [post, s.height, s.depth], offset: [-(s.width - post) / 2, s.height / 2, 0], slot: 'frame' },
      { shape: 'box', dims: [post, s.height, s.depth], offset: [(s.width - post) / 2, s.height / 2, 0], slot: 'frame' },
      { shape: 'box', dims: [s.width, rail, post], offset: [0, s.height - rail / 2, 0], slot: 'frame' },
    ]
  },
  model: '/props/divider-screen.glb',
  thumbnail: '/thumbs/divider-screen.webp',
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

/**
 * A person, for scale — source doc §17: "a human figure should be added to the
 * library and it can be placed anywhere, including places other elements are not
 * allowed; there is already a model for it and no image is needed."
 *
 * ONE figure, and it is a woman. The user wrote "human figure"; the file they
 * supplied is `דמות אישה.glb` (8.52 MB, 2026-07-29 13:49) and it is the only one
 * in the folder. A male counterpart was NOT generated to round out the pair —
 * that is the real-inventory principle (presets.ts:7-9) exactly: one entry per
 * thing that exists. The question is asked in handoff/BLOCKED-02-A2.md.
 *
 * The pose is a T-stance, arms straight out, which is why the plan footprint is
 * 155 cm wide for a 28 cm depth: the width is the ARM SPAN, not the shoulders.
 * That is the model as delivered and it is what the top-down plan image draws.
 *
 * ⚠ THE HEIGHT IS THE ONE NUMBER NOT TAKEN FROM THE FILE. The GLB is normalised
 * to 92.4 × 16.9 × 98.2 cm — arm span ≈ height, which is the correct adult
 * proportion, so the model is right and only its scale is arbitrary (a Tripo-style
 * unit export). A 98 cm person standing next to a 75 cm table is a doll, and the
 * whole point of the item is to read the room's scale, so it is catalogued at
 * 165 cm and every axis carries the same ratio. That is the second question in
 * BLOCKED-02-A2: one number to change if the user wants another height.
 *
 * `modelSize` is the file's own measured bounds, as everywhere else — the loader
 * fits by `size / modelSize`, and stating the file's size rather than a scale
 * factor is what stops the two drifting apart (catalog/types.ts).
 *
 * No product photo exists and none is coming, so the library tile is the model
 * rendered from the front by tools/model-elevation.mjs; the mapping row in
 * tools/thumbs-prep.mjs carries the reasoning. The slot colour is the measured
 * mean of that render (#65605b over 40,655 opaque pixels), not a guess — it only
 * tints the 2D shape, since the GLB's materials are baked.
 */
export const humanFigure: CatalogEntry = {
  id: 'figure.woman',
  category: 'decor',
  labelKey: 'humanFigure',
  promptFragment: 'a woman standing, in a plain long-sleeved top and jeans',
  defaultSize: { width: 155.3, depth: 28.4, height: 165 },
  modelSize: { width: 92.4, depth: 16.9, height: 98.2 },
  // Source doc §17. See CatalogEntry.placeAnywhere for why this is a flag of its
  // own rather than a `zoneKind` or an `allowedZones` list.
  placeAnywhere: true,
  resizable: [],
  minSize: {},
  maxSize: {},
  materialSlots: [{ name: 'figure', labelKey: 'figure', defaultColor: '#65605b' }],
  footprint: (s) => ({
    parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: s.depth / 2, slot: 'figure' }],
    outline: { kind: 'rect', w: s.width, h: s.depth },
  }),
  // Fallback only — the GLB is the real render. Legs, torso, head, at the
  // fractions of total height a standing adult actually divides into.
  buildMesh: (s) => [
    { shape: 'cylinder', dims: [s.depth * 0.5, s.depth * 0.4, s.height * 0.48], offset: [0, s.height * 0.24, 0], slot: 'figure' },
    { shape: 'cylinder', dims: [s.depth * 0.62, s.depth * 0.55, s.height * 0.38], offset: [0, s.height * 0.67, 0], slot: 'figure' },
    { shape: 'sphere', dims: [s.height * 0.07], offset: [0, s.height * 0.93, 0], slot: 'figure' },
  ],
  model: '/props/figure-woman.glb',
  thumbnail: '/thumbs/figure-woman.webp',
  // The tile would otherwise print "1.55 × 0.28 מ'", which is the arm span and
  // reads as the size of a piece of furniture. Source doc §20 already says decor
  // is bought by look; here the only number worth showing is the height, and the
  // subtitle cannot show it.
  librarySubtitle: 'none',
}

export const decorEntries = [pottedPlant, pottedPlant2, dividerScreen, arcLampCrystal, humanFigure]
