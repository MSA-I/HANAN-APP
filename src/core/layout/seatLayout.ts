/**
 * Pure seat-placement math. Given a table outline and a seating config,
 * returns parent-relative chair transforms (chair front faces the table).
 */
import type { CatalogEntry, Outline } from '../catalog/types'
import type { SeatingConfig, Size3D, Transform2D } from '../model/types'
import { degToRad } from '../space'

/**
 * Seats for a catalog entry: its own `seats` function when it has one (the
 * serpentine, whose seat line is neither a circle nor a rectangle), otherwise
 * the generic outline math. Callers that have an entry should use these two
 * rather than computeSeatTransforms/computeMaxSeats directly.
 */
export function seatsForEntry(
  entry: CatalogEntry,
  size: Size3D,
  seating: SeatingConfig,
  chair: Size3D,
): Transform2D[] {
  if (entry.seats) return entry.seats(seating, chair)
  return computeSeatTransforms(entry.footprint(size).outline, seating, chair)
}

/**
 * Capacity for a catalog entry. For a custom `seats` it asks for more chairs
 * than could possibly fit and counts what comes back, so capacity is defined by
 * the placement code itself and the two cannot drift apart.
 */
export function maxSeatsForEntry(
  entry: CatalogEntry,
  size: Size3D,
  seating: SeatingConfig,
  chair: Size3D,
): number {
  if (entry.seats) return entry.seats({ ...seating, count: Number.MAX_SAFE_INTEGER }, chair).length
  return computeMaxSeats(entry.footprint(size).outline, seating, chair)
}

/** How many chairs physically fit around the outline. */
export function computeMaxSeats(outline: Outline, seating: SeatingConfig, chair: Size3D): number {
  const unit = chair.width + seating.gap
  if (outline.kind === 'circle') {
    const r = outline.r + seating.offset + chair.depth / 2
    return Math.max(0, Math.floor((2 * Math.PI * r) / unit))
  }
  const perSide = (len: number) => Math.max(0, Math.floor(len / unit))
  return 2 * perSide(outline.w) + 2 * perSide(outline.h)
}

export function computeSeatTransforms(
  outline: Outline,
  seating: SeatingConfig,
  chair: Size3D,
): Transform2D[] {
  const count = Math.min(seating.count, computeMaxSeats(outline, seating, chair))
  if (count <= 0) return []
  return outline.kind === 'circle'
    ? circleSeats(outline.r, count, seating, chair)
    : rectSeats(outline.w, outline.h, count, seating, chair)
}

function circleSeats(
  tableR: number,
  count: number,
  seating: SeatingConfig,
  chair: Size3D,
): Transform2D[] {
  const r = tableR + seating.offset + chair.depth / 2
  const out: Transform2D[] = []
  for (let i = 0; i < count; i++) {
    const a = seating.startAngle + (i * 360) / count
    const rad = degToRad(a)
    out.push({
      position: { x: Math.cos(rad) * r, y: Math.sin(rad) * r },
      // chair front (-y at rotation 0) must point at the center
      rotation: a - 90,
      elevation: 0,
    })
  }
  return out
}

type Side = 'top' | 'bottom' | 'right' | 'left'
const SIDE_ORDER: Side[] = ['top', 'bottom', 'right', 'left']

function rectSeats(
  w: number,
  d: number,
  count: number,
  seating: SeatingConfig,
  chair: Size3D,
): Transform2D[] {
  const unit = chair.width + seating.gap
  const lengths: Record<Side, number> = { top: w, bottom: w, right: d, left: d }
  const caps: Record<Side, number> = {
    top: Math.floor(w / unit),
    bottom: Math.floor(w / unit),
    right: Math.floor(d / unit),
    left: Math.floor(d / unit),
  }
  const perimeter = 2 * (w + d)

  // Largest-remainder allocation proportional to side length, capped per side.
  const alloc: Record<Side, number> = { top: 0, bottom: 0, right: 0, left: 0 }
  let remaining = count
  const shares = SIDE_ORDER.map((side) => ({
    side,
    ideal: (count * lengths[side]) / perimeter,
  }))
  for (const s of shares) {
    const base = Math.min(Math.floor(s.ideal), caps[s.side])
    alloc[s.side] = base
    remaining -= base
  }
  const byRemainder = [...shares].sort(
    (a, b) => (b.ideal - Math.floor(b.ideal)) - (a.ideal - Math.floor(a.ideal)),
  )
  while (remaining > 0) {
    let placed = false
    for (const s of byRemainder) {
      if (remaining === 0) break
      if (alloc[s.side] < caps[s.side]) {
        alloc[s.side]++
        remaining--
        placed = true
      }
    }
    if (!placed) break // all sides at capacity
  }

  const outTop = d / 2 + seating.offset + chair.depth / 2
  const outSide = w / 2 + seating.offset + chair.depth / 2
  const out: Transform2D[] = []
  for (const side of SIDE_ORDER) {
    const n = alloc[side]
    const len = lengths[side]
    for (let k = 0; k < n; k++) {
      const along = ((k + 0.5) / n) * len - len / 2
      switch (side) {
        case 'top':
          out.push({ position: { x: along, y: -outTop }, rotation: 180, elevation: 0 })
          break
        case 'bottom':
          out.push({ position: { x: along, y: outTop }, rotation: 0, elevation: 0 })
          break
        case 'right':
          out.push({ position: { x: outSide, y: along }, rotation: 270, elevation: 0 })
          break
        case 'left':
          out.push({ position: { x: -outSide, y: along }, rotation: 90, elevation: 0 })
          break
      }
    }
  }
  return out
}
