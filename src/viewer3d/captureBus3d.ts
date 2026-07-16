/**
 * Decouples "capture a clean PNG of the 3D view" from the R3F Canvas that can
 * produce it. A component inside the Canvas registers the capture function once
 * mounted; callers (the future Generate flow) invoke `capture3d` without importing
 * anything three-related. The captured frame is what gets sent to the AI model.
 */
export interface Capture3dOptions {
  /** target pixel size — matches the AI model's expected input (e.g. 1536×1024) */
  width: number
  height: number
}

export type Capture3dFn = (opts: Capture3dOptions) => string | null

let current: Capture3dFn | null = null

export function registerCapture3d(fn: Capture3dFn | null): void {
  current = fn
}

export function capture3d(opts: Capture3dOptions): string | null {
  return current ? current(opts) : null
}
