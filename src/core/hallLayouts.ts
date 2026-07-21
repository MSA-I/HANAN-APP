/**
 * Named hall layouts ("פריסות אולם") — a curated arrangement of table+chair
 * units at explicit plan positions, authored per venue pack. Deliberately NOT
 * parametric (rows/rings): the real layouts are specific arrangements around
 * the hall's fixed zones (pool, dancefloor, chuppah) that parameters cannot
 * express, and explicit data is exactly what the SVG schematic renders — one
 * source of truth for both the apply action and the picker thumbnail.
 *
 * Same registry rules as presets.ts: plain data, never persisted (applying
 * produces ordinary scene objects tagged `meta.layout`), and every referenced
 * id must already exist (placements reuse TABLE_PRESETS — enforced by
 * presets.test.ts).
 */
import { getTablePreset } from './presets'

export interface LayoutPlacement {
  /** id into TABLE_PRESETS — table + chair + seat count, no duplication */
  presetId: string
  /** plan cm, table centre */
  x: number
  y: number
  /** degrees, clockwise in plan view */
  rotation?: number
}

export interface HallLayout {
  id: string
  /** key into strings.presets.items */
  labelKey: string
  /** the venue pack this layout was authored for */
  venuePackId: string
  placements: LayoutPlacement[]
}

/** Grid helper for authoring: one placement per (x, y) pair. */
const grid = (presetId: string, xs: number[], ys: number[], rotation?: number): LayoutPlacement[] =>
  ys.flatMap((y) => xs.map((x) => ({ presetId, x, y, ...(rotation ? { rotation } : {}) })))

/**
 * PLACEHOLDER layouts — the user will supply the venue's real layouts, and
 * these two exist only to exercise the pipeline (schema → apply → schematic).
 * Positions sit inside the resort floorAreas, clear of the restricted zones.
 * Replace the entries; keep the shape.
 */
export const HALL_LAYOUTS: HallLayout[] = [
  {
    id: 'layout.rounds-classic',
    labelKey: 'layoutRoundsClassic',
    venuePackId: 'resort',
    placements: [
      // west wing, above the pool
      ...grid('preset.round-12-gold-white', [250, 650, 1050, 1450], [250, 650, 1050]),
      // west strip, beside the pool
      ...grid('preset.round-12-gold-white', [250, 550], [1700, 2100]),
      // east wing, between dancefloor and corridor
      ...grid('preset.round-12-gold-white', [2840, 3240, 3640], [250, 650, 1050]),
    ],
  },
  {
    id: 'layout.knights-rows',
    labelKey: 'layoutKnightsRows',
    venuePackId: 'resort',
    placements: [
      // west wing: two long tables per row, three rows
      ...grid('preset.knights-22-brown', [500, 1290], [250, 750, 1250]),
      // east wing mirrors it
      ...grid('preset.knights-22-brown', [2890, 3660], [250, 750, 1250]),
    ],
  },
]

export function getHallLayout(id: string): HallLayout | undefined {
  return HALL_LAYOUTS.find((l) => l.id === id)
}

export function layoutsForVenue(venuePackId: string | null | undefined): HallLayout[] {
  if (!venuePackId) return []
  return HALL_LAYOUTS.filter((l) => l.venuePackId === venuePackId)
}

/** Card stats: how many tables and seats applying this layout produces. */
export function layoutStats(layout: HallLayout): { tables: number; seats: number } {
  let seats = 0
  for (const p of layout.placements) seats += getTablePreset(p.presetId)?.seatCount ?? 0
  return { tables: layout.placements.length, seats }
}
