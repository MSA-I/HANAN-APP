import type { ZoomApi } from './useEditorShortcuts'

/** Lets chrome outside Stage2D (status bar) drive the stage viewport. */
let api: ZoomApi | null = null

export function registerZoomApi(a: ZoomApi | null): void {
  api = a
}

export function zoomApi(): ZoomApi | null {
  return api
}
