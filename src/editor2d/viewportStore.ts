import { create } from 'zustand'

/** 100% zoom = 64 px per meter = 0.64 px per cm. */
export const ZOOM_100 = 0.64
export const ZOOM_MIN = ZOOM_100 * 0.05
export const ZOOM_MAX = ZOOM_100 * 8

interface ViewportState {
  /** Konva stage scale (px per cm) */
  zoom: number
  setZoom: (zoom: number) => void
}

export const useViewportStore = create<ViewportState>()((set) => ({
  zoom: ZOOM_100,
  setZoom: (zoom) => set({ zoom }),
}))

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}
