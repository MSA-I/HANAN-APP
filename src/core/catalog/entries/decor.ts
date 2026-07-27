import type { CatalogEntry } from '../types'

function vegetationEntry(
  id: string,
  labelKey: string,
  size: { width: number; depth: number; height: number },
  model: string,
  siting?: Pick<CatalogEntry, 'allowedZones' | 'nearWall'>,
): CatalogEntry {
  return {
    id,
    category: 'decor',
    labelKey,
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
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

/**
 * `plant.potted` is retained so saved projects continue to load as vegetation 1.
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
  { width: 101, depth: 94.6, height: 160 },
  '/props/plant-vegetation-1.glb',
)

/**
 * Vegetation 2 goes against walls only, the passage included (source doc §15).
 * 60cm is the plant's own 47.5cm footprint plus a hand's width — it is the
 * threshold for "touching the wall", not a design distance, so it is here rather
 * than in a tunable.
 */
export const pottedPlant2 = vegetationEntry(
  'plant.potted-2',
  'plant2',
  { width: 47.5, depth: 43.8, height: 160 },
  '/props/plant-vegetation-2.glb',
  { nearWall: 60 },
)

export const dividerScreen: CatalogEntry = {
  id: 'divider.screen',
  category: 'decor',
  labelKey: 'divider',
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
 * Size = the normalised GLB bounds (`modelSize` below) at 2×, the height the
 * real stand reads at (§10 of the corrections document); the loader grows the
 * model to `defaultSize` so the plan footprint and the rendered stand stay the
 * same object. The slot colour is the model's measured mean base colour (baked
 * materials, so 2D only).
 */
export const arcLampCrystal: CatalogEntry = {
  id: 'lamp.arc-crystal',
  category: 'decor',
  labelKey: 'lampArcCrystal',
  defaultSize: { width: 54.4, depth: 87.4, height: 160 },
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
