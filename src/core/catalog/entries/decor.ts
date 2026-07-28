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
 * ⛔ Source doc §14 puts it in a ring AROUND the pool, and `allowedZones` is the
 * mechanism for exactly that — but the ring's WIDTH has no measured source. The
 * plan's 150cm is its own admitted guess, and the number decides whether the
 * rule reads as "on the pool coping" (~80) or "the whole pool side of the hall"
 * (~300). Left unwired until the user answers; see handoff/BLOCKED-03-A2.md §1.
 * One line here when the number arrives:
 *   { allowedZones: [{ kind: 'pool', within: <cm> }] }
 */
export const pottedPlant = vegetationEntry(
  'plant.potted',
  'plant',
  'a large potted green plant',
  { width: 151.5, depth: 141.9, height: 240 },
  '/props/plant-vegetation-1.glb',
  // the prepped file's own bounds — the pre-1.5× defaultSize
  { width: 101, depth: 94.6, height: 160 },
)

/**
 * Vegetation 2 goes against walls only, the passage included (source doc §15).
 * 60cm is the threshold for "touching the wall", not a design distance, so it is
 * here rather than in a tunable. Collision measures it EDGE to wall
 * (`contourDistance − shapeReach`, collision.ts:475-480), so it is independent of
 * how wide the plant is and the ×1.5 below does not move it.
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
  { nearWall: 60 },
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
