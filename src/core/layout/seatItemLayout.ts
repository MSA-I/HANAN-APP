/**
 * Pure place-setting math: given the chair transforms seatLayout produced, put one
 * item on the table in front of each of them. Works in the SEAT's own frame, so
 * there is no round/rect branching — a seat already carries the direction its
 * guest faces, and that is the only thing the layout needs.
 */
import type { Outline } from '../catalog/types'
import type { Size3D, Transform2D, Vec2 } from '../model/types'
import { rotateVec } from '../space'
import { holeRadius } from './bounds'

/**
 * @param seats      chair transforms from computeSeatTransforms (parent-relative)
 * @param chair      the chair's size — its depth sets how far the seat sits out
 * @param item       the item's size — its depth sets how far in from the rim it lands
 * @param seatOffset SeatingConfig.offset: cm from table edge to chair edge
 * @param top        the parent's top outline. Only its HOLE is read — see `clearOfHole`
 * @param edgeInset  cm of tablecloth left visible between rim and item
 */
export function seatItemTransforms(
  seats: Transform2D[],
  chair: Size3D,
  item: Size3D,
  seatOffset: number,
  top?: Outline,
  edgeInset = 3,
): Transform2D[] {
  // seat centre → item centre, measured along the seat's front. The seat sits
  // (offset + chair.depth/2) outside the rim, so the item lands exactly
  // (edgeInset + item.depth/2) inside it, whatever the table's shape.
  const d = seatOffset + chair.depth / 2 + edgeInset + item.depth / 2
  const hole = top ? holeRadius(top) : 0
  return seats.map((seat) => {
    const front = rotateVec({ x: 0, y: -1 }, seat.rotation)
    // the setting must face the seated guest, i.e. away from the table: the
    // seat's front points in, so the item's is the opposite one
    const rotation = seat.rotation + 180
    const centre = {
      x: seat.position.x + front.x * d,
      y: seat.position.y + front.y * d,
    }
    return {
      position: hole > 0 ? clearOfHole(centre, rotation, item, hole) : centre,
      rotation,
      elevation: 0,
    }
  })
}

/**
 * Source doc §43 — the one thing the seat's frame cannot see.
 *
 * Everything above works in the seat's own frame and is therefore shape-agnostic:
 * the item is pushed in from the rim the seat was measured against, so the OUTER
 * edge takes care of itself on a circle, a rectangle and the serpentine's band
 * alike. A RING has a second edge the seat knows nothing about — the ⌀380's ⌀156
 * opening — and a push that crosses it puts a place setting over the floor.
 *
 * So this is a one-directional guard: push the item back OUT until its whole
 * rotated footprint clears the opening, and never pull it in.
 *
 * Parent-local coordinates, so the ring is centred on the origin and `holeRadius`
 * is the whole of the test — `pointInHole` wants a placed world transform and would
 * only be the same arithmetic with a zero offset added to it.
 *
 * ⚠ Measured, so nobody mistakes this for a repair: at the catalog's numbers it
 * NEVER fires. A cover on the ⌀380 lands at r = 171.35 and its nearest corner at
 * r = 156.7, against a hole of 78 — it would take an item ~186 cm deep to reach the
 * opening. This turns a property that was true by accident into one that is true by
 * construction, and seatItemLayout.test.ts is where the 156.7 is pinned.
 */
function clearOfHole(p: Vec2, rotation: number, item: Size3D, hole: number): Vec2 {
  const len = Math.hypot(p.x, p.y)
  // dead centre has no radial direction to push along, and is only reachable on a
  // table narrower than the reach it was laid with
  if (len === 0) return p
  // exact support of the rotated rectangle along the radial direction — the same
  // quantity clampToSurface measures, and the reason neither may use a circumradius
  const u = rotateVec({ x: p.x / len, y: p.y / len }, -rotation)
  const minR = hole + (Math.abs(u.x) * item.width + Math.abs(u.y) * item.depth) / 2
  if (len >= minR) return p
  return { x: (p.x / len) * minR, y: (p.y / len) * minR }
}
