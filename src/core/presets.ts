/**
 * Static registries of ready-made layouts ("פריסות"), shaped exactly like
 * venuePacks.ts: plain data, no React/Konva/three, never persisted. Applying a
 * preset produces ordinary scene objects, so nothing here reaches a saved file
 * beyond a `meta.design` tag — which is why the schema version is untouched.
 *
 * REAL-INVENTORY PRINCIPLE: every id below must already exist in the catalog.
 * A preset composes the venue's actual furniture; it never implies a new asset.
 * presets.test.ts enforces that against the registry and the string dictionary.
 */
import { getCatalogEntry } from './catalog/registry'
import type { SeatingConfig } from './model/types'

/** A table and its chairs, dropped as one unit from the library. */
export interface TablePreset {
  id: string
  /** key into strings.presets.items */
  labelKey: string
  tableCatalogId: string
  chairCatalogId: string
  seatCount: number
}

/**
 * A named set of table-top decor laid on ONE table.
 *
 * Offsets are table-local cm and default to 0. Keep |x| ≤ 40: on the smallest
 * table (⌀180 with 12 place settings) the free centre band is only ~⌀108.
 * Anything that overshoots is pulled back by clampToSurface rather than falling
 * off, so this is a crowding guideline, not a correctness one.
 */
export interface TableDesign {
  id: string
  labelKey: string
  items: { catalogId: string; x?: number; y?: number; rotation?: number }[]
  /** a placement:'seat' entry laid in front of EVERY chair */
  seatItem?: string
  /** picker image override (e.g. a 3D capture of the dressed table); when
   *  absent the picker falls back to the centerpiece's catalog thumbnail */
  thumbnail?: string
}

/** Ceiling fixtures spread on a grid over the hall. */
export interface HallDesign {
  id: string
  labelKey: string
  /** must be a placement:'ceiling' entry */
  catalogId: string
  /** target centre-to-centre pitch, cm */
  spacing: number
}

export const TABLE_PRESETS: TablePreset[] = [
  { id: 'preset.round-12-gold-white', labelKey: 'presetRound12GoldWhite', tableCatalogId: 'table.round', chairCatalogId: 'chair.gold-white', seatCount: 12 },
  { id: 'preset.round-10-x-white', labelKey: 'presetRound10XWhite', tableCatalogId: 'table.round', chairCatalogId: 'chair.x-white', seatCount: 10 },
  { id: 'preset.round-large-22-gold-black', labelKey: 'presetRoundLarge22GoldBlack', tableCatalogId: 'table.round-large', chairCatalogId: 'chair.gold-black', seatCount: 22 },
  // 8, not the catalog's defaultCount of 12: a 160cm side takes floor(160/(45+10))
  // = 2 chairs, so 12 gets clamped to 8 by the seat reconciler anyway. The label
  // has to say what will actually appear. (The catalog default is over-stated the
  // same way — pre-existing, left alone here.)
  { id: 'preset.square-8-x-wood', labelKey: 'presetSquare8XWood', tableCatalogId: 'table.square', chairCatalogId: 'chair.x-wood', seatCount: 8 },
  { id: 'preset.banquet-12-black', labelKey: 'presetBanquet12Black', tableCatalogId: 'table.banquet', chairCatalogId: 'chair.black', seatCount: 12 },
  { id: 'preset.knights-22-brown', labelKey: 'presetKnights22Brown', tableCatalogId: 'table.knights-480', chairCatalogId: 'chair.brown', seatCount: 22 },
]

export const TABLE_DESIGNS: TableDesign[] = [
  {
    id: 'design.classic-gold',
    labelKey: 'designClassicGold',
    items: [
      { catalogId: 'decor.candelabrum-gold' },
      { catalogId: 'decor.candlestick-gold', x: -38 },
      { catalogId: 'decor.candlestick-gold', x: 38 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    id: 'design.crystal',
    labelKey: 'designCrystal',
    items: [
      { catalogId: 'decor.candelabra-crystal' },
      { catalogId: 'decor.candleholder-crystal-a', x: -35 },
      { catalogId: 'decor.candleholder-crystal-a', x: 35 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    id: 'design.floral-pink',
    labelKey: 'designFloralPink',
    items: [
      { catalogId: 'decor.tulips-pink' },
      { catalogId: 'decor.vase-flowers-b', x: -40 },
      { catalogId: 'decor.vase-flowers-b', x: 40 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    id: 'design.rustic-wood',
    labelKey: 'designRusticWood',
    items: [
      { catalogId: 'decor.topiary-green' },
      { catalogId: 'decor.candlestick-wood', x: -32 },
      { catalogId: 'decor.candlestick-wood', x: 32 },
    ],
    seatItem: 'decor.place-setting',
  },
]

export const HALL_DESIGNS: HallDesign[] = [
  { id: 'hall.pendants', labelKey: 'hallPendants', catalogId: 'lamp.pendant', spacing: 250 },
  { id: 'hall.pendant-clusters', labelKey: 'hallPendantClusters', catalogId: 'lamp.pendant-cluster', spacing: 350 },
  { id: 'hall.chandeliers-diamond', labelKey: 'hallChandeliersDiamond', catalogId: 'lamp.chandelier-diamond', spacing: 400 },
  { id: 'hall.chandeliers-basket', labelKey: 'hallChandeliersBasket', catalogId: 'lamp.chandelier-basket', spacing: 500 },
  { id: 'hall.chandeliers-candelabra', labelKey: 'hallChandeliersCandelabra', catalogId: 'lamp.chandelier-candelabra', spacing: 600 },
]

export function getTablePreset(id: string): TablePreset | undefined {
  return TABLE_PRESETS.find((p) => p.id === id)
}

export function getTableDesign(id: string): TableDesign | undefined {
  return TABLE_DESIGNS.find((d) => d.id === id)
}

export function getHallDesign(id: string): HallDesign | undefined {
  return HALL_DESIGNS.find((d) => d.id === id)
}

/** The seating a preset produces: the table's catalog defaults, its chair, its count. */
export function presetSeating(preset: TablePreset): SeatingConfig {
  const cap = getCatalogEntry(preset.tableCatalogId).seating
  if (!cap) throw new Error(`preset ${preset.id}: ${preset.tableCatalogId} cannot seat`)
  return {
    enabled: true,
    chairCatalogId: preset.chairCatalogId,
    count: preset.seatCount,
    gap: cap.defaultGap,
    offset: cap.defaultOffset,
    startAngle: 0,
  }
}
