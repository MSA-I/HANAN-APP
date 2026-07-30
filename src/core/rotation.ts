/**
 * The rotation rule, in one place, for BOTH renderers.
 *
 * The user's decision (round 4): free rotation is the DEFAULT and `Shift` opts
 * INTO the snap — the opposite of round 3, where 15° snapping was always on. So
 * the whole module is built around one property: `step === 0` is an exact
 * passthrough. That is not a convenience branch, it is the decision itself
 * expressed as code, and `rotation.test.ts` pins it first.
 *
 * Angles are plan degrees — clockwise, y-down, an object facing -y at 0 (see
 * core/space.ts, the only place a unit or an angle is ever converted).
 */
import { normalizeDeg } from './space'

/**
 * The snap the user chose: eight positions, the hall's diagonals included.
 *
 * 45 and not 15: at 15° a "snapped" table is 24 positions round the circle,
 * which is close enough to free that the snap stopped being a decision and the
 * free rotation stopped being distinguishable from it.
 */
export const ROTATION_SNAP_DEG = 45

/**
 * `normalizeDeg` with an EXACT identity for angles already in range.
 *
 * `normalizeDeg` is `((d % 360) + 360) % 360` — a round trip through `d + 360`,
 * and that round trip is lossy: measured, `normalizeDeg(37.3)` is
 * 37.30000000000001 and `normalizeDeg(0.1)` is 0.10000000000002274. Every stored
 * rotation is already in [0, 360), and `snapAngle(x, 0)` runs once per frame of a
 * free rotate drag, so the loss would compound over a gesture AND make "the user
 * chose no snap" impossible to state as an equality. Values in range skip the
 * arithmetic entirely; everything else goes through `space.ts` as usual.
 */
function wrap(deg: number): number {
  return deg >= 0 && deg < 360 ? deg : normalizeDeg(deg)
}

/**
 * Snap an angle to the nearest multiple of `step`, normalised to [0, 360).
 *
 * `step <= 0` (and a non-finite step) means NO SNAP: the angle comes back
 * untouched apart from the wrap. That is the default path.
 *
 * Three properties the tests pin, each for a reason:
 *
 *  - The result is never 360. `snapAngle(358, 45)` rounds up to a full turn, and
 *    an unnormalised 360 would print as "360°", compare unequal to the 0 it means,
 *    and round-trip badly through the next `normalizeDeg`.
 *  - The answer depends only on the ANGLE, never on how it was spelled:
 *    `snapAngle(x, s) === snapAngle(x + 360, s)`. That is why the wrap happens
 *    BEFORE the snap rather than after it.
 *  - Ties round CLOCKWISE (up). `Math.round` breaks .5 toward +∞, and since the
 *    wrap runs first every input is non-negative, so "up" is the whole rule
 *    rather than "away from zero" with a sign-dependent edge.
 *
 * A non-finite angle returns 0 rather than propagating: a NaN rotation reaches a
 * Konva `rotation` and a three.js `rotation.y`, and both render nothing at all —
 * the object simply vanishes, which reads as a load failure rather than as bad
 * input.
 */
export function snapAngle(deg: number, step: number): number {
  if (!Number.isFinite(deg)) return 0
  const wrapped = wrap(deg)
  if (!Number.isFinite(step) || step <= 0) return wrapped
  return wrap(Math.round(wrapped / step) * step)
}

/**
 * Every angle a snap of `step` can land on, ascending from 0 and below 360 —
 * what a rotation ring draws its ticks at, so the ticks cannot disagree with
 * where the table actually stops.
 *
 * Empty for `step <= 0`: free rotation has no positions, and an empty array is
 * what a renderer maps over to draw nothing.
 */
export function rotationSnapsDeg(step: number): number[] {
  if (!Number.isFinite(step) || step <= 0) return []
  const out: number[] = []
  // i * step rather than an accumulator: adding a float 360/step times drifts,
  // and a tick that lands on 314.99999 instead of 315 is a visible seam.
  for (let i = 0, n = Math.ceil(360 / step); i < n; i++) {
    const angle = i * step
    if (angle < 360) out.push(angle)
  }
  return out
}
