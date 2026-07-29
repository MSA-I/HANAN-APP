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
  /**
   * Hebrew label used until `strings.presets.items[labelKey]` exists. The
   * dictionary is PLAN-02's file, so a design authored in another plan cannot
   * seed its own key; it carries the text here and `PresetsSection`'s `label()`
   * falls back to it. The requested keys are listed in
   * `Plans/R2/handoff/FOUND-08.md` — once they land this field is dead weight
   * and the dictionary wins on its own.
   */
  pendingLabel?: string
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
  /**
   * Height at which this design hangs its fixtures, in plan cm above the floor
   * (source doc §43). Absent → each fixture keeps the seeded hang height.
   * Clamped by clampHang, so a value outside the venue's range settles at the edge
   * rather than being rejected.
   */
  floorDistance?: number
}

export const TABLE_PRESETS: TablePreset[] = [
  { id: 'preset.round-12-gold-white', labelKey: 'presetRound12GoldWhite', tableCatalogId: 'table.round', chairCatalogId: 'chair.gold-white', seatCount: 12 },
  { id: 'preset.round-10-x-white', labelKey: 'presetRound10XWhite', tableCatalogId: 'table.round', chairCatalogId: 'chair.x-white', seatCount: 10 },
  { id: 'preset.round-large-22-gold-black', labelKey: 'presetRoundLarge22GoldBlack', tableCatalogId: 'table.round-large', chairCatalogId: 'chair.gold-black', seatCount: 22 },
  // 10, matching the square table's own defaultCount (corrections document §48).
  // It is a choice, not a ceiling: at the table's defaultGap of 8 a 160cm side
  // takes floor(160/53) = 3 chairs, so 12 would fit and the reconciler will not
  // clamp 10 down. The preset id still says "8" because ids are stable — saved
  // projects reference it; the label now reads 10 (strings.presets.items
  // .presetSquare8XWood, owned by PLAN-02) and all three places agree.
  { id: 'preset.square-8-x-wood', labelKey: 'presetSquare8XWood', tableCatalogId: 'table.square', chairCatalogId: 'chair.x-wood', seatCount: 10 },
  { id: 'preset.banquet-12-black', labelKey: 'presetBanquet12Black', tableCatalogId: 'table.banquet', chairCatalogId: 'chair.black', seatCount: 12 },
  { id: 'preset.knights-22-brown', labelKey: 'presetKnights22Brown', tableCatalogId: 'table.knights-480', chairCatalogId: 'chair.brown', seatCount: 22 },
  { id: 'preset.serpentine-20-x-white', labelKey: 'presetSerpentine20XWhite', tableCatalogId: 'table.serpentine', chairCatalogId: 'chair.x-white', seatCount: 20 },
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

  // -------------------------------------------------------------------------
  // Source doc §30: new designs, "existing items compared against a check on
  // the internet". What the trade actually says, and what it changed here:
  //
  //  1. SIGHTLINES. The one rule every banquet source repeats: a centrepiece is
  //     either LOW — under ~35 cm / 14in for a round table — or TALL enough that
  //     the eye passes under its canopy (60-70 cm+). The band in between is
  //     seated eye level (a 75 cm top plus ~35-45 cm to the eye) and is where
  //     guests stop being able to see each other. The catalog splits on exactly
  //     that line: the four 'tableDesigns' pieces are 70-85 cm, the candle rows
  //     are 20-30 cm, and most of 'tableDecor' sits in the 35-55 blind band. So
  //     every design below is either a tall centrepiece over low flanks, or all
  //     three pieces under 35.
  //  2. RULE OF THREE, symmetrical. Three pieces, mirrored about the centre —
  //     which is what the four designs above already do, and it is not a
  //     coincidence (see 3).
  //  3. HOW MANY PIECES FIT, measured rather than styled: on the ⌀180 round the
  //     ring of 12 place settings puts their inner edge at r = 90 − 3 (cloth
  //     inset) − 31.3/2 (setting depth) = 55.7, i.e. a ⌀111 free centre, and the
  //     |y| ≤ 15 envelope makes every design a line along x. Budget: 80 cm of x
  //     for the whole arrangement. A centrepiece plus ONE mirrored pair fits with
  //     the ~15 cm of air the sources ask for between candles; a second pair does
  //     not, at any offset. Three is the count the table permits.
  //  4. Offsets are ABSOLUTE table-local cm (see the interface doc above) —
  //     `layTableDesign` lays `{x, y}` as given. Only a user-SAVED design is
  //     rescaled by table size (`designFromSavedLayout`).
  //
  // Every gap below is centre-to-centre minus both outlines, computed against
  // the catalog's real `defaultSize`; presets.test.ts re-checks them through
  // `checkPlacement` so a future size change cannot quietly close one.
  // -------------------------------------------------------------------------

  {
    // ⌀37.2 crystal candelabrum, 75 cm, over two 20 cm rows of tealights.
    // Gap 38 − 2.7 − 19.75 = 15.55 cm, the "candles a hand apart" figure.
    id: 'design.crystal-tall',
    labelKey: 'designCrystalTall',
    pendingLabel: 'קריסטל גבוה',
    items: [
      { catalogId: 'design.candelabrum-crystal' },
      { catalogId: 'decor.candleholders-glass', x: -38 },
      { catalogId: 'decor.candleholders-glass', x: 38 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    // The tallest piece the venue owns (85 cm, every candle in its own chimney)
    // with the slim crystal holder rows at 30 cm. Gap 33 − 4.75 − 13.15 = 15.1.
    id: 'design.hurricane-glass',
    labelKey: 'designHurricaneGlass',
    pendingLabel: 'הוריקן זכוכית',
    items: [
      { catalogId: 'design.candelabrum-hurricane' },
      { catalogId: 'decor.candleholder-crystal-a', x: -33 },
      { catalogId: 'decor.candleholder-crystal-a', x: 33 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    // Orchids in a brass frame, 80 cm, over turned wooden holders at 25 cm —
    // the warm counterpart to the two crystal sets. Gap 32 − 2.65 − 13.2 = 16.15.
    id: 'design.orchid-white',
    labelKey: 'designOrchidWhite',
    pendingLabel: 'סחלב לבן',
    items: [
      { catalogId: 'design.orchid-sculpture' },
      { catalogId: 'decor.candleholders-wood', x: -32 },
      { catalogId: 'decor.candleholders-wood', x: 32 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    // Six glass rods on one mirrored base, 70 cm, flanked by slim gold tapers.
    // The centre is the only RECT centrepiece here, so the gap is measured to its
    // side rather than to a radius: 30 − 6.25 − 10.4 = 13.35.
    id: 'design.gold-rods',
    labelKey: 'designGoldRods',
    pendingLabel: 'מוטות זכוכית וזהב',
    items: [
      { catalogId: 'design.lamp-glass-rod' },
      { catalogId: 'decor.candlestick-gold', x: -30 },
      { catalogId: 'decor.candlestick-gold', x: 30 },
    ],
    seatItem: 'decor.place-setting',
  },
  {
    // The low school, which the sources call the safer choice for a round table:
    // nothing here passes 35 cm, so the whole table stays under the sightline.
    // Gap 40 − 9.45 − 16.8 = 13.75, and the outer reach 49.45 keeps 6 cm of cloth
    // between the striped vase and the place settings at 55.7.
    id: 'design.ceramic-low',
    labelKey: 'designCeramicLow',
    pendingLabel: 'קרמיקה נמוכה',
    items: [
      { catalogId: 'decor.vases-white-ceramic' },
      { catalogId: 'decor.vase-striped', x: -40 },
      { catalogId: 'decor.vase-striped', x: 40 },
    ],
    seatItem: 'decor.place-setting',
  },
]

/**
 * Source doc §43 — every design states the height it hangs its fixtures at, so
 * applying one produces a trimmed rig instead of five fixtures left wherever
 * `createObject` seeded them (top touching the truss).
 *
 * The numbers are the fixture's OWN legal band, not a house figure: in the resort
 * (truss 895, roof 1160, MAX_DROP_FROM_CEILING 650) `hangRange` gives
 * `[max(0, 510 − height), 895 − height]`, and `transform.elevation` is the BOTTOM
 * of the fixture — so `floorDistance` is literally the distance from the floor.
 *
 *   design                fixture height   legal band     floorDistance   cord
 *   pendants                    125        [385, 770]         440          330
 *   pendant clusters            150        [360, 745]         450          295
 *   chandeliers diamond         225        [285, 670]         480          190
 *   chandeliers basket          275        [235, 620]         500          120
 *   chandeliers candelabra      300        [210, 595]         520           75
 *
 * Two readings of the same table. Bottoms rise with the fixture: the ⌀229
 * candelabra needs more air under it than a ⌀32 pendant before the room reads as
 * low. Tops rise faster: the last column is the procedural cord `cordLength`
 * opens above the fixture, and it shortens from 3.3 m to 0.75 m as the piece gets
 * heavier — a small pendant is cord-hung by design and drops far, a 2.5 m
 * candelabra hangs off a short chain close to the truss. Every value is strictly
 * inside its band, so none of them is a number that would silently clamp.
 */
export const HALL_DESIGNS: HallDesign[] = [
  { id: 'hall.pendants', labelKey: 'hallPendants', catalogId: 'lamp.pendant', spacing: 250, floorDistance: 440 },
  // ⚠ THIS DESIGN NOW OVERREACHES ITS OWN FIXTURE, and the fix is not in this file.
  // Source doc §29 confines `lamp.pendant-cluster` to the bar zone, which
  // entries/hanging.ts now states as `allowedZones`, so every cluster this design
  // drops outside that rectangle lands illegal-where-it-stands: legal to drag,
  // refused if re-dropped, red in the status bar. Narrowing the design to the bar
  // means narrowing the AREAS it fills, and those come from `ceilingAreas()` inside
  // `applyHallDesign` (state/actions.ts:1249-1262) — a file PLAN-02 may not touch.
  // Written up with the exact change in Plans/R3/handoff/FOUND-02.md.
  { id: 'hall.pendant-clusters', labelKey: 'hallPendantClusters', catalogId: 'lamp.pendant-cluster', spacing: 350, floorDistance: 450 },
  { id: 'hall.chandeliers-diamond', labelKey: 'hallChandeliersDiamond', catalogId: 'lamp.chandelier-diamond', spacing: 400, floorDistance: 480 },
  { id: 'hall.chandeliers-basket', labelKey: 'hallChandeliersBasket', catalogId: 'lamp.chandelier-basket', spacing: 500, floorDistance: 500 },
  { id: 'hall.chandeliers-candelabra', labelKey: 'hallChandeliersCandelabra', catalogId: 'lamp.chandelier-candelabra', spacing: 600, floorDistance: 520 },
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
