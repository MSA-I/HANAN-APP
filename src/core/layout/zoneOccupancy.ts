/**
 * Zone-label visibility. A venue zone (pool, bar, dance floor…) shows its name
 * until its own furniture stands on it, then gets out of the way.
 *
 * The test is "an object's CENTRE is inside the zone", not "its box overlaps".
 * Overlap looks equivalent and is not: furniture is clamped OUT of restricted
 * zones, so a table beside the pool comes to rest exactly against the pool edge
 * and touches it forever — an overlap test would hide "בריכה" the moment anyone
 * filled the room. A centre test only fires for things actually standing there,
 * which is what the request meant, and it covers zones with a matching
 * `zoneKind` (bar, DJ, chuppah) and those without one (pool, dance floor) the
 * same way, so there is one rule rather than two.
 */
import type { Vec2 } from '../model/types'

export interface ZoneRect {
  x: number
  y: number
  width: number
  depth: number
}

export function isPointInZone(point: Vec2, zone: ZoneRect): boolean {
  return (
    point.x >= zone.x &&
    point.x <= zone.x + zone.width &&
    point.y >= zone.y &&
    point.y <= zone.y + zone.depth
  )
}

/** Does anything stand on this zone? `centres` are world-space object centres. */
export function isZoneOccupied(zone: ZoneRect, centres: readonly Vec2[]): boolean {
  return centres.some((c) => isPointInZone(c, zone))
}

/**
 * Is this zone sitting on top of that one? Same centre rule as everything else
 * here, and deliberately the same question ObjectsLayer asks of an object:
 * WHERE it is drawn, never what it IS.
 *
 * It exists because `kind` is the wrong answer to that question. The reception
 * deck carries a chuppah of its own (`kind: 'chuppah'`, +5.20), and grouping the
 * hall/reception toggle by kind put it with the HALL — so it showed at full
 * strength while you were in the hall and vanished the moment you switched to
 * reception, the exact inverse of "another chuppah zone, only when I turn the
 * reception on" (source doc item 19).
 */
export function isZoneInside(inner: ZoneRect, outer: ZoneRect): boolean {
  return isPointInZone({ x: inner.x + inner.width / 2, y: inner.y + inner.depth / 2 }, outer)
}
