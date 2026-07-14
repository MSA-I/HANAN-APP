/**
 * Decouples "export a PNG of the plan" from the Konva Stage that can produce it.
 * Stage2D registers a capture function once it mounts; export code (and the
 * autosave preview) call `capture()` without importing anything Konva.
 */
export interface CaptureOptions {
  pixelRatio: number
  /** hide grid/overlay/selection, force a white background, keep labels on */
  clean: boolean
}

export type CaptureFn = (opts: CaptureOptions) => string | null

let current: CaptureFn | null = null

export function registerCapture(fn: CaptureFn | null): void {
  current = fn
}

export function capture(opts: CaptureOptions): string | null {
  return current ? current(opts) : null
}
