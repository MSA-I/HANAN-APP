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
 * The seats that take a PLACE SETTING — every one of them, unless the entry says
 * otherwise through `seatItemSeats`.
 *
 * A separate function from `seatsForEntry` rather than a flag on it, because the
 * two questions have different answers and both are asked of the same table: the
 * CHAIRS are reconciled by index against `seats` and every one of them stays, and
 * the covers are one-shot children laid in front of a subset. Filtering here — on
 * the array, before `seatItemTransforms` ever sees it — is what keeps that subset
 * out of `reconcileSeats`' index contract entirely.
 *
 * On the serpentine this drops the two heads, whose covers lie at 90° to their
 * flank neighbours and interpenetrate them by a measured 12…15 cm at every
 * position inside the band (layout/serpentine.ts). 22 chairs, 20 covers.
 */
export function seatItemSeatsForEntry(
  entry: CatalogEntry,
  size: Size3D,
  seating: SeatingConfig,
  chair: Size3D,
): Transform2D[] {
  const seats = seatsForEntry(entry, size, seating, chair)
  if (!entry.seatItemSeats) return seats
  const wanted = new Set(entry.seatItemSeats(seating, chair))
  return seats.filter((_, i) => wanted.has(i))
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

/**
 * The largest gap, in whole cm up to `limit`, that still seats `target` chairs.
 *
 * Capacity is a step function of gap — a side takes ⌊len/(width+gap)⌋ chairs —
 * and the steps are narrow where it matters: the 160 square seats 12 at gap 8 and
 * 8 at gap 9, the 480 knights table 22 at gap 8 and 20 at gap 9. The inspector
 * exposed gap as a free 0–60 field, so a single nudge silently deleted four
 * chairs. Capping the field here is what stops that.
 *
 * Monotonic in gap (more space per chair can never fit more chairs), so the scan
 * downward from `limit` returns the true maximum on the first hit. Brute force
 * over ≤61 integers rather than inverting each outline's formula: it is the same
 * answer for any outline, including the serpentine's custom `seats`.
 */
export function maxGapForSeats(
  entry: CatalogEntry,
  size: Size3D,
  seating: SeatingConfig,
  chair: Size3D,
  target: number,
  limit = 60,
): number {
  for (let gap = limit; gap > 0; gap--) {
    if (maxSeatsForEntry(entry, size, { ...seating, gap }, chair) >= target) return gap
  }
  return 0
}

/** How many chairs physically fit around the outline. */
export function computeMaxSeats(outline: Outline, seating: SeatingConfig, chair: Size3D): number {
  const unit = chair.width + seating.gap
  if (outline.kind === 'circle') {
    // a ring (outline.rInner set) seats round its OUTER edge like any disc — the
    // hole is inside the table, nowhere near where a chair goes
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
