/**
 * Geometry of the venue's serpentine ("שולחן נחש") table: a curved band whose
 * centre line is an S, fitted to the real model, `public/props/table-serpentine.glb`.
 *
 * It lives here rather than in seatLayout.ts because it is the one table whose
 * seat line is neither a circle nor a rectangle. Rather than add a third
 * `Outline` variant — which nine consumers (bounds, snapping, clamping, both
 * selection visuals, the library thumb) would each have to grow a case for —
 * the catalog entry keeps a rect `outline` of its bounding box and supplies
 * these functions through `CatalogEntry.seats`. The bounding box is
 * conservative: it is larger than the table, so snapping and venue clamping err
 * in the safe direction.
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
 * One arc of the centre line, in the direction the band is walked.
 *
 * `turn` is SIGNED: positive sweeps clockwise on screen. Where consecutive turns
 * disagree in sign the curvature flips, and that is what makes a join an S
 * rather than a C — so the sign belongs to each arc, not to the table.
 */
export interface SerpentineArc {
  /** centre, plan cm, relative to the object origin (= the GLB's bbox centre) */
  cx: number
  cy: number
  /** centre-line radius */
  r: number
  /** angle where travel along this arc starts */
  from: number
  /** signed sweep, degrees */
  turn: number
}

/**
 * Band width across the centre line, cm.
 *
 * This is a DECISION, not a measurement. The user gave 80 cm from their real
 * inventory and width is the dining-critical dimension, so the GLB was scaled
 * until its median width sat exactly there. The model's width is not perfectly
 * constant — it runs 75…85 — and fitting the arcs with the band left free lets
 * the optimiser buy accuracy by widening it (it reached 87 when allowed), which
 * would draw a table wider than the one being planned. It is pinned here and the
 * arcs were fitted subject to it.
 *
 * A consequence worth knowing before anyone treats overlap as the quality bar:
 * because the model's silhouette is NOT constant-width, no constant-width band
 * can score above about 0.85 IoU against it, and this one reaches 0.88. The
 * remaining gap is the drape flaring past the nominal 80 at the caps and along
 * the outer edge — drawing the nominal width is the correct behaviour there, so
 * centre-line deviation, not IoU, is what the arc count was chosen on.
 */
export const SERPENTINE_BAND = 80

/**
 * Where the band starts: the first arc's centre and the angle travel begins at.
 * Only the first arc gets a centre — the rest are derived (see `buildChain`).
 */
const CHAIN_START = { cx: 116.9, cy: -116.1, from: 73.5 }

/**
 * Each arc's centre-line radius and signed sweep, in walking order.
 *
 * Fitted from the prepped GLB, not chosen: the plan silhouette was rasterised to
 * a 0.5 cm grid, its medial line recovered from an exact Euclidean distance
 * transform, split into arcs by dynamic programming over circle-fit residuals,
 * and refined against the raster by intersection-over-union.
 *
 * THREE arcs, because the long arm's curvature drifts (R ≈ 276 → 173) and one
 * arc cannot follow it: the fitted centre line sits 1.37 cm rms / 2.69 cm max
 * from the measured medial line, against 3.04 / 5.52 for two arcs. Four is
 * where it stops paying — the extra split lands two arcs of R = 210.1 and
 * R = 210.9 on the same stretch of curve, which is one arc described twice.
 *
 * ⚠ Provenance, because these numbers will look wrong later. The user's real
 * table is 80 × 300 cm. This Tripo model's proportions are NOT that: its band to
 * centre-line ratio is about 1:7 where the real table is 1:3.75, and no uniform
 * scale satisfies both. Width won, so the GLB is scaled until its median band is
 * 80 — which makes the plan footprint 4.22 × 4.22 m, larger than the ⌀380 round
 * and the biggest item in the catalog. That is a real consequence of honouring
 * the 80 cm band on this model, not a scaling mistake. The width and the seat
 * capacity are right; the overall length is the model's, not the inventory's.
 */
const CHAIN: ReadonlyArray<{ r: number; turn: number }> = [
  { r: 275.7, turn: 47.5 },
  { r: 173.1, turn: 64.6 },
  { r: 145.3, turn: -61.8 },
]

/**
 * Builds the chain from the head arc plus each following arc's radius and signed
 * sweep. Every centre after the first is DERIVED so that the tangent is
 * continuous across each join: a chain of independently-placed circles would
 * have a visible kink at every one of them, and no test of "is the centre line
 * still the right length" would catch it.
 *
 * Which side the next centre goes on is what encodes the curvature: the same
 * sign of turn keeps it on the same side (a smooth continuation, centres
 * |Ra − Rb| apart), an opposite sign puts it across the join (the S, centres
 * Ra + Rb apart).
 */
function buildChain(
  start: { cx: number; cy: number; from: number },
  chain: ReadonlyArray<{ r: number; turn: number }>,
): SerpentineArc[] {
  const out: SerpentineArc[] = []
  for (let i = 0; i < chain.length; i++) {
    const { r, turn } = chain[i]
    if (i === 0) {
      out.push({ cx: start.cx, cy: start.cy, r, from: start.from, turn })
      continue
    }
    const prev = out[i - 1]
    const end = prev.from + prev.turn
    const ux = Math.cos(degToRad(end))
    const uy = Math.sin(degToRad(end))
    const joinX = prev.cx + prev.r * ux
    const joinY = prev.cy + prev.r * uy
    const sameWay = Math.sign(turn) === Math.sign(prev.turn)
    out.push({
      cx: joinX + (sameWay ? -r : r) * ux,
      cy: joinY + (sameWay ? -r : r) * uy,
      r,
      // seen from its own centre the join sits opposite when the curvature flips
      from: sameWay ? end : end + 180,
      turn,
    })
  }
  return out
}

/** The centre line, in walking order. Everything below is derived from these. */
export const SERPENTINE_ARCS: readonly SerpentineArc[] = buildChain(CHAIN_START, CHAIN)

/**
 * Which flank of the centre line "side +1" is on for a given arc.
 *
 * Walking the band, the left-hand side is the OUTSIDE of an arc that turns one
 * way and the INSIDE of one that turns the other. So the face that is outside
 * arc 1 is inside any arc whose turn disagrees with it — which is exactly why a
 * seat row can cross an inflection without leaving the side of the table it
 * started on.
 */
function flank(arc: SerpentineArc): number {
  return Math.sign(arc.turn) === Math.sign(SERPENTINE_ARCS[0].turn) ? 1 : -1
}

/**
 * The annular sectors that draw the band, in the shape Konva's <Arc> takes
 * directly — so the S is a handful of parts, not a chain of tiles. `sweep` is
 * normalised positive because Konva draws a negative angle as the 360°
 * complement, which would fill the whole ring.
 */
export function serpentineArcs(): Array<{
  cx: number
  cy: number
  innerR: number
  outerR: number
  startAngle: number
  sweep: number
}> {
  return SERPENTINE_ARCS.map((a) => ({
    cx: a.cx,
    cy: a.cy,
    innerR: a.r - SERPENTINE_BAND / 2,
    outerR: a.r + SERPENTINE_BAND / 2,
    startAngle: Math.min(a.from, a.from + a.turn),
    sweep: Math.abs(a.turn),
  }))
}

/**
 * Origin-centred conservative box of the band. Exact rather than sampled: an
 * annular sector's extremes are its four corners, plus the outer radius wherever
 * the sector crosses a cardinal direction. The fitted chain is offset by a few
 * centimetres inside the GLB frame, so width/depth are twice the largest absolute
 * coordinate rather than merely max−min; a centred rect then contains every part.
 *
 * This is the bbox of the FITTED ARCS. The catalog entry declares the prepped
 * GLB's own bbox instead, because that is what the 3D model occupies; the gap
 * between them is the arc approximation, and the entry taking the larger of the
 * two keeps the outline conservative.
 */
export function serpentineBounds(): { width: number; depth: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const touch = (x: number, y: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  for (const a of serpentineArcs()) {
    for (const t of [0, a.sweep]) {
      for (const radius of [a.innerR, a.outerR]) {
        const rad = degToRad(a.startAngle + t)
        touch(a.cx + Math.cos(rad) * radius, a.cy + Math.sin(rad) * radius)
      }
    }
    for (const cardinal of [0, 90, 180, 270]) {
      const t = (((cardinal - a.startAngle) % 360) + 360) % 360
      if (t > a.sweep) continue
      const rad = degToRad(cardinal)
      touch(a.cx + Math.cos(rad) * a.outerR, a.cy + Math.sin(rad) * a.outerR)
    }
  }
  return {
    width: 2 * Math.max(Math.abs(minX), Math.abs(maxX)),
    depth: 2 * Math.max(Math.abs(minY), Math.abs(maxY)),
  }
}

/** Distance from the centre line to the seat line: half the band, plus the chair. */
function seatOffset(seating: SeatingConfig, chair: Size3D): number {
  return SERPENTINE_BAND / 2 + seating.offset + chair.depth / 2
}

/**
 * Radius of the seat line along one arc, for one flank of the band.
 *
 * Clamped at zero: on the concave side of an arc tighter than the seat offset,
 * r − d goes negative and the seat line would invert through the centre and come
 * back out on the far side, seating chairs inside the curve facing the wrong
 * way. A curve that tight genuinely has no room for chairs on its inside, and a
 * zero-length segment is how that gets said.
 */
function seatRadius(arc: SerpentineArc, side: number, d: number): number {
  return Math.max(0, arc.r + side * flank(arc) * d)
}

/**
 * Length of the seat line on one flank of the band.
 *
 * ⚠ The two flanks are NOT the same length. A seat row runs at radius r+d on one
 * arc and r−d on the next wherever the curvature flips, so the offsets cancel —
 * but only to the extent those arcs sweep through the same angle. In general the
 * flanks differ by 2·d·Σ(flank·|turn|), which is well over a metre here. So one
 * flank seats more chairs than the other, and capacity DOES depend on chair
 * depth.
 */
function edgeLength(side: number, d: number): number {
  return SERPENTINE_ARCS.reduce(
    (total, a) => total + degToRad(Math.abs(a.turn)) * seatRadius(a, side, d),
    0,
  )
}

const SIDES = [1, -1]

/** How many chairs fit on each flank, in SIDES order. */
function capacities(seating: SeatingConfig, chair: Size3D): number[] {
  const unit = chair.width + seating.gap
  const d = seatOffset(seating, chair)
  return SIDES.map((side) => Math.max(0, Math.floor(edgeLength(side, d) / unit)))
}

export function serpentineMaxSeats(seating: SeatingConfig, chair: Size3D): number {
  return capacities(seating, chair).reduce((a, b) => a + b, 0)
}

/**
 * Seat transforms, parent-relative, chair fronts facing the table.
 *
 * The band has exactly TWO edges, and a row of seats walks each one continuously
 * from end to end — crossing from the convex to the concave face at each
 * inflection. Treating it instead as "outer and inner edge per arc" is the
 * tempting mistake: the concave face of one arc and the convex face of the next
 * are the same physical side, so two chairs would land on the identical point at
 * every join.
 */
export function serpentineSeats(seating: SeatingConfig, chair: Size3D): Transform2D[] {
  const caps = capacities(seating, chair)
  const total = Math.min(seating.count, caps[0] + caps[1])
  if (total <= 0) return []

  const d = seatOffset(seating, chair)
  // fill the flanks alternately so a partial count stays balanced around the
  // table, but never past what a flank holds — they have different capacities
  const want = [0, 0]
  let remaining = total
  while (remaining > 0) {
    let placed = false
    for (let i = 0; i < SIDES.length && remaining > 0; i++) {
      if (want[i] < caps[i]) {
        want[i]++
        remaining--
        placed = true
      }
    }
    if (!placed) break
  }

  const out: Transform2D[] = []
  SIDES.forEach((side, i) => {
    const n = want[i]
    if (n === 0) return
    // an arc whose seat line has been clamped away is not walked along at all
    const segments = SERPENTINE_ARCS.map((arc) => {
      const radius = seatRadius(arc, side, d)
      return { arc, radius, len: degToRad(Math.abs(arc.turn)) * radius }
    }).filter((s) => s.len > 0)
    if (segments.length === 0) return
    const len = segments.reduce((a, b) => a + b.len, 0)

    for (let k = 0; k < n; k++) {
      let s = ((k + 0.5) / n) * len
      let index = 0
      while (index < segments.length - 1 && s > segments[index].len) {
        s -= segments[index].len
        index++
      }
      const { arc, radius } = segments[index]
      const theta = arc.from + Math.sign(arc.turn) * radToDeg(s / radius)
      const rad = degToRad(theta)
      out.push({
        position: {
          x: arc.cx + Math.cos(rad) * radius,
          y: arc.cy + Math.sin(rad) * radius,
        },
        // a seat OUTSIDE its arc's centre faces in (θ−90, as circleSeats does);
        // one INSIDE the centre-line radius must face out, hence the sign flip
        rotation: theta - 90 * side * flank(arc),
        elevation: 0,
      })
    }
  })
  return out
}
