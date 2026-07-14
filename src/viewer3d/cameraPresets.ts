/**
 * Named camera placements for the 3D viewer, framed to the current venue.
 * All distances derive from the venue size (meters), so presets scale with the
 * room. Applied via camera-controls setLookAt (optionally animated).
 */
import type CameraControls from 'camera-controls'
import type { Venue } from '../core/model/types'
import { cmToM } from '../core/space'

export type CameraPreset = 'overview' | 'top' | 'eye'

export function applyCameraPreset(
  controls: CameraControls,
  venue: Venue,
  preset: CameraPreset,
  transition = true,
): void {
  const W = cmToM(venue.size.width)
  const D = cmToM(venue.size.depth)
  const H = cmToM(venue.wallHeight)
  const cx = W / 2
  const cz = D / 2
  const diag = Math.hypot(W, D)

  if (preset === 'top') {
    // near top-down — tiny z offset avoids a degenerate up-vector
    controls.setLookAt(cx, diag * 1.4, cz + 0.0001, cx, 0, cz, transition)
    return
  }
  if (preset === 'eye') {
    // eye height, standing INSIDE the room near the front (+z) wall — outside
    // it the wall fills the frame — looking across toward the far end
    controls.setLookAt(cx, 1.6, D - 1.2, cx, 1.4, D * 0.15, transition)
    return
  }
  // overview — a raised 3/4 view that frames the whole venue
  controls.setLookAt(cx - W * 0.12, diag * 0.6, cz + D * 0.65 + diag * 0.35, cx, H * 0.25, cz, transition)
}
