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

/**
 * Of these candidates, the one the point stands in — else the nearest by centre.
 *
 * A `zoneKind` names a FAMILY of rectangles, not one rectangle, and the resort has
 * two chuppah zones: the hall's at +0.50 and the reception deck's at +5.20. Picking
 * the first of the family is picking by array order, which is how a chuppah placed
 * on the deck came to be drawn 4.70 m below it — standing in the void under the
 * deck, inside the building's walls.
 *
 * The fallback is "nearest" rather than "none" so that an object clamped hard
 * against the outside of its home rectangle still reads the level it belongs to,
 * and it matches how `clampToVenue` chooses that home in the first place.
 */
export function zoneUnder<T extends ZoneRect>(candidates: readonly T[], point: Vec2): T | undefined {
  const standingOn = candidates.find((z) => isPointInZone(point, z))
  if (standingOn) return standingOn
  let best: T | undefined
  let bestDistance = Infinity
  for (const z of candidates) {
    const d = Math.hypot(z.x + z.width / 2 - point.x, z.y + z.depth / 2 - point.y)
    if (d < bestDistance) {
      bestDistance = d
      best = z
    }
  }
  return best
}
