/**
 * Geometry of the venue's serpentine ("שולחן נחש") table: two equal arcs of
 * opposite curvature joined tangentially into an S, seating 22.
 *
 * It lives here rather than in seatLayout.ts because it is the one table whose
 * seat line is neither a circle nor a rectangle. Rather than add a third
 * `Outline` variant — which nine consumers (bounds, snapping, clamping, both
 * selection visuals, the library thumb) would each have to grow a case for —
 * the catalog entry keeps a rect `outline` of its bounding box and supplies
 * these functions directly. The bounding box is conservative: it is larger than
 * the table, so snapping and venue clamping err in the safe direction.
 *
 * Known consequence, accepted: hit-testing uses that box, so a decor item can be
 * dropped into the concave pocket of the S and will attach to the table while
 * visually floating over the floor. Fixing it needs one pure `pointInParts`
 * helper in bounds.ts, not a union change.
 *
 * Plan space throughout: x right, y down, angles in degrees measured as
 * atan2(y, x) — i.e. increasing θ turns clockwise on screen.
 */
import type { SeatingConfig, Size3D, Transform2D } from '../model/types'
import { degToRad, radToDeg } from '../space'

/**
 * Centre-line radius, sweep per arc and band width, in cm. These three numbers
 * fix everything else — bounds and capacity are derived, never written down
 * twice. R and SWEEP were chosen to seat exactly 22 at a comfortable pitch while
 * reading as a wide, shallow S (589 × 340 cm) rather than a horseshoe.
 */
export const SERPENTINE = { r: 300, sweep: 60, band: 80 } as const

/**
 * The two arc centres. Arc A is swept over θ ∈ [90, 90+sweep] about (0, −r) and
 * arc B over θ ∈ [270, 270+sweep] about (0, +r); both reach the origin at their
 * shared end (θ = 90 and θ = 270 respectively), where their tangents agree and
 * their curvature flips — which is what makes the join an S and not a C.
 */
const CENTER_A = -SERPENTINE.r
const CENTER_B = +SERPENTINE.r

/**
 * Bounding box of the band. Closed form so `defaultSize` is derived from the
 * constants above and cannot drift out of sync with them.
 */
export function serpentineBounds(): { width: number; depth: number } {
  const { r, sweep, band } = SERPENTINE
  const rad = degToRad(sweep)
  return {
    width: 2 * (r + band / 2) * Math.sin(rad),
    depth: 2 * (r - (r - band / 2) * Math.cos(rad)),
  }
}

/**
 * The two annular sectors that draw the band, in the shape Konva's <Arc> and the
 * 3D 'arc' MeshPart both take directly (centre, inner/outer radius, start angle,
 * clockwise sweep) — so the S is 2 parts in 2D and 2 in 3D, not a chain of tiles.
 */
export function serpentineArcs(): Array<{
  cx: number
  cy: number
  innerR: number
  outerR: number
  startAngle: number
  sweep: number
}> {
  const { r, sweep, band } = SERPENTINE
  const ring = { cx: 0, innerR: r - band / 2, outerR: r + band / 2, sweep }
  return [
    { ...ring, cy: CENTER_A, startAngle: 90 },
    { ...ring, cy: CENTER_B, startAngle: 270 },
  ]
}

/** Distance from the centre line to the seat line: half the band, plus the chair. */
function seatOffset(seating: SeatingConfig, chair: Size3D): number {
  return SERPENTINE.band / 2 + seating.offset + chair.depth / 2
}

/**
 * How many chairs fit. The offsets cancel: a seat row runs at radius r+d along
 * one arc and r−d along the other, so its total length is 2·φ·r for BOTH sides,
 * independent of d. Capacity therefore depends only on r and sweep.
 */
export function serpentineMaxSeats(seating: SeatingConfig, chair: Size3D): number {
  const unit = chair.width + seating.gap
  const lineLength = 2 * degToRad(SERPENTINE.sweep) * SERPENTINE.r
  return Math.max(0, 2 * Math.floor(lineLength / unit))
}

/**
 * Seat transforms, parent-relative, chair fronts facing the table.
 *
 * The band has exactly TWO edges, and a row of seats walks each one continuously
 * from end to end — crossing from the convex to the concave face at the
 * inflection point. Treating it instead as "outer and inner edge per arc" is the
 * tempting mistake: arc A's concave face and arc B's convex face are the same
 * physical side, so two chairs would land on the identical point at the join.
 */
export function serpentineSeats(seating: SeatingConfig, chair: Size3D): Transform2D[] {
  const count = Math.min(seating.count, serpentineMaxSeats(seating, chair))
  if (count <= 0) return []

  const { r, sweep } = SERPENTINE
  const d = seatOffset(seating, chair)
  const sweepRad = degToRad(sweep)
  const out: Transform2D[] = []

  // sides are filled alternately so a partial count stays balanced around the table
  for (const side of [1, -1]) {
    const n = side === 1 ? Math.ceil(count / 2) : Math.floor(count / 2)
    const rA = r + side * d
    const rB = r - side * d
    const lenA = sweepRad * rA
    const total = lenA + sweepRad * rB

    for (let k = 0; k < n; k++) {
      const s = ((k + 0.5) / n) * total
      const onA = s <= lenA
      const radius = onA ? rA : rB
      const center = onA ? CENTER_A : CENTER_B
      // walk arc A backwards from its far end to the origin, then arc B onwards
      const theta = onA
        ? 90 + sweep - radToDeg(s / rA)
        : 270 + radToDeg((s - lenA) / rB)
      const rad = degToRad(theta)
      out.push({
        position: {
          x: Math.cos(rad) * radius,
          y: center + Math.sin(rad) * radius,
        },
        // a seat OUTSIDE its arc's centre faces in (θ−90, as circleSeats does);
        // one INSIDE the centre-line radius must face out, hence the sign flip
        rotation: onA ? theta - 90 * side : theta + 90 * side,
        elevation: 0,
      })
    }
  }
  return out
}
