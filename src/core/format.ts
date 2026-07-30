/**
 * How a measurement is written down — the NUMBER only.
 *
 * The unit is the caller's: `strings.units` owns "מ׳" and "°" so a readout can be
 * translated, mirrored or dropped without touching arithmetic, and so this module
 * stays node-testable with no UI import. Callers write `` `${metersValue(cm)} ${S.units.m}` ``.
 *
 * It exists because the same `(v / 100).toFixed(2)` had been written out by hand
 * in `editor2d/OverlayLayer.tsx` and `ui/StatusBar.tsx`, and the two readouts sit
 * a centimetre apart on screen — the wall-distance badge and the cursor position.
 * Both are reproduced here exactly, so adopting this changes no pixel.
 */
import { cmToM } from './space'

/**
 * Centimetres → metres, two decimals. `250` → `'2.50'`.
 *
 * The one thing it does that the hand-written version did not: it refuses to
 * print a signed zero. A cursor a third of a millimetre left of the origin is
 * -0.004 m, which `toFixed(2)` renders `-0.00` — a minus sign in front of a zero,
 * on a readout that updates on every mouse move, and the eye reads it as a glitch
 * rather than as precision. Anything that rounds to zero prints unsigned.
 */
export function metersValue(cm: number): string {
  if (!Number.isFinite(cm)) return '0.00'
  const out = cmToM(cm).toFixed(2)
  // Number('-0.00') is -0, and -0 === 0 — so this catches the signed zero at any
  // precision rather than matching the one string '-0.00' spells it as today.
  return Number(out) === 0 ? out.replace('-', '') : out
}

/**
 * Plan degrees, at most one decimal, trailing `.0` dropped. `45` → `'45'`,
 * `37.30000000000001` → `'37.3'`.
 *
 * One decimal because round 4 made free rotation the default: whole degrees would
 * make every free angle print as a lie, and two would print the float noise that
 * `core/rotation.ts` documents. It does NOT normalise — wrapping an angle is
 * `space.ts`'s job, and a formatter that silently changed 400 into 40 would hide
 * an un-normalised value instead of showing it.
 */
export function degreesValue(deg: number): string {
  if (!Number.isFinite(deg)) return '0'
  const rounded = Math.round(deg * 10) / 10
  // 359.96 rounds to 360 — a full turn the object has not made. Degrees are
  // cyclic, so the honest print of "just short of all the way round" is 0.
  const cyclic = rounded === 360 && deg < 360 ? 0 : rounded
  const out = cyclic.toFixed(1)
  return out.endsWith('.0') ? out.slice(0, -2) : out
}
