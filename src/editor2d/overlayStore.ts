import { create } from 'zustand'
import type { AABB } from '../core/layout/bounds'

export interface Marquee {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PlacingGhost {
  x: number
  y: number
  valid: boolean
}

interface OverlayState {
  guides: { x: number | null; y: number | null }
  /** combined AABB of the dragged selection, for wall-distance indicators */
  dragBox: AABB | null
  marquee: Marquee | null
  spacePan: boolean
  /** persistent hand tool (toolbar H) */
  handTool: boolean
  shiftHeld: boolean
  /** click-to-place mode armed with a catalog id */
  placing: string | null
  ghost: PlacingGhost | null
  cursorWorld: { x: number; y: number } | null
  helpOpen: boolean
}

export const useOverlayStore = create<OverlayState>()(() => ({
  guides: { x: null, y: null },
  dragBox: null,
  marquee: null,
  spacePan: false,
  handTool: false,
  shiftHeld: false,
  placing: null,
  ghost: null,
  cursorWorld: null,
  helpOpen: false,
}))

export const overlay = {
  setGuides(x: number | null, y: number | null) {
    useOverlayStore.setState({ guides: { x, y } })
  },
  setDragBox(dragBox: AABB | null) {
    useOverlayStore.setState({ dragBox })
  },
  setMarquee(marquee: Marquee | null) {
    useOverlayStore.setState({ marquee })
  },
  setSpacePan(spacePan: boolean) {
    useOverlayStore.setState({ spacePan })
  },
  setShiftHeld(shiftHeld: boolean) {
    useOverlayStore.setState({ shiftHeld })
  },
  clearDragVisuals() {
    useOverlayStore.setState({ guides: { x: null, y: null }, dragBox: null })
  },
  setHandTool(handTool: boolean) {
    useOverlayStore.setState({ handTool })
  },
  setPlacing(placing: string | null) {
    useOverlayStore.setState({ placing, ghost: placing ? useOverlayStore.getState().ghost : null })
  },
  setGhost(ghost: PlacingGhost | null) {
    useOverlayStore.setState({ ghost })
  },
  setCursorWorld(cursorWorld: { x: number; y: number } | null) {
    useOverlayStore.setState({ cursorWorld })
  },
  toggleHelp() {
    useOverlayStore.setState((s) => ({ helpOpen: !s.helpOpen }))
  },
  setHelpOpen(helpOpen: boolean) {
    useOverlayStore.setState({ helpOpen })
  },
}
