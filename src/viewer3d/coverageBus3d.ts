/**
 * Decouples "measure what is actually visible in this frame" from the R3F Canvas
 * that can do it — the same shape as `captureBus3d.ts`, and for the same reason:
 * the caller is a toolbar button outside the Canvas and must not import three.
 *
 * A component inside the Canvas registers the measuring function while mounted;
 * `measureCoverage3d()` returns `undefined` when nothing is registered, which is
 * exactly the "nobody measured" state `core/prompts/refs.ts` already treats as
 * "the frustum is the answer". A build with no 3D view mounted therefore behaves
 * precisely as it did before PLAN-05 C3.
 */
import type { Coverage } from '../core/prompts/refs'

export type MeasureCoverage3dFn = () => Coverage | undefined

let current: MeasureCoverage3dFn | null = null

export function registerMeasureCoverage3d(fn: MeasureCoverage3dFn | null): void {
  current = fn
}

export function measureCoverage3d(): Coverage | undefined {
  return current ? current() : undefined
}
