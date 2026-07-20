/**
 * Pure place-setting math: given the chair transforms seatLayout produced, put one
 * item on the table in front of each of them. Works in the SEAT's own frame, so
 * there is no round/rect branching — a seat already carries the direction its
 * guest faces, and that is the only thing the layout needs.
 */
import type { Size3D, Transform2D } from '../model/types'
import { rotateVec } from '../space'

/**
 * @param seats      chair transforms from computeSeatTransforms (parent-relative)
 * @param chair      the chair's size — its depth sets how far the seat sits out
 * @param item       the item's size — its depth sets how far in from the rim it lands
 * @param seatOffset SeatingConfig.offset: cm from table edge to chair edge
 * @param edgeInset  cm of tablecloth left visible between rim and item
 */
export function seatItemTransforms(
  seats: Transform2D[],
  chair: Size3D,
  item: Size3D,
  seatOffset: number,
  edgeInset = 3,
): Transform2D[] {
  // seat centre → item centre, measured along the seat's front. The seat sits
  // (offset + chair.depth/2) outside the rim, so the item lands exactly
  // (edgeInset + item.depth/2) inside it, whatever the table's shape.
  const d = seatOffset + chair.depth / 2 + edgeInset + item.depth / 2
  return seats.map((seat) => {
    const front = rotateVec({ x: 0, y: -1 }, seat.rotation)
    return {
      position: { x: seat.position.x + front.x * d, y: seat.position.y + front.y * d },
      // the setting must face the seated guest, i.e. away from the table: the
      // seat's front points in, so the item's is the opposite one
      rotation: seat.rotation + 180,
      elevation: 0,
    }
  })
}
