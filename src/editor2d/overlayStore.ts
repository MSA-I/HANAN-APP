import { create } from 'zustand'
import type { AABB } from '../core/layout/bounds'
import type { Violation } from '../core/layout/collision'

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
  /**
   * Set when `placing` was armed by a preset rather than a bare catalog item.
   * `placing` still holds a REAL catalog id (the preset's table), so the ghost
   * and its validity test keep working untouched — this only tells the drop
   * handler to add the whole unit.
   */
  placingPreset: string | null
  /**
   * Object id armed for "replace with the next library click". It lives here and
   * not in LibraryPanel because three places arm it — the library button, the
   * inspector and the canvas context menu — and only the library can disarm it.
   */
  replaceTarget: string | null
  ghost: PlacingGhost | null
  cursorWorld: { x: number; y: number } | null
  /**
   * Why the last placement or move was refused — what the status bar reads. Set
   * by the single write path (state/actions.ts) and by the ghost, cleared by the
   * next mutation that succeeds.
   */
  violation: Violation | null
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
  placingPreset: null,
  replaceTarget: null,
  ghost: null,
  cursorWorld: null,
  violation: null,
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
    useOverlayStore.setState({
      placing,
      placingPreset: null,
      replaceTarget: placing ? null : useOverlayStore.getState().replaceTarget,
      ghost: placing ? useOverlayStore.getState().ghost : null,
    })
  },
  /** Arm/disarm "replace this object with the next library pick". Cancels placing. */
  setReplaceTarget(replaceTarget: string | null) {
    useOverlayStore.setState({
      replaceTarget,
      placing: replaceTarget ? null : useOverlayStore.getState().placing,
      placingPreset: replaceTarget ? null : useOverlayStore.getState().placingPreset,
    })
  },
  /** Arm a preset: the ghost shows its table, the drop adds table + chairs. */
  setPlacingPreset(presetId: string | null, tableCatalogId: string | null) {
    useOverlayStore.setState({
      placing: presetId ? tableCatalogId : null,
      placingPreset: presetId,
      ghost: presetId ? useOverlayStore.getState().ghost : null,
    })
  },
  setGhost(ghost: PlacingGhost | null) {
    useOverlayStore.setState({ ghost })
  },
  setCursorWorld(cursorWorld: { x: number; y: number } | null) {
    useOverlayStore.setState({ cursorWorld })
  },
  /** No-op when the reason has not changed — the ghost re-asks on every mouse move. */
  setViolation(violation: Violation | null) {
    const previous = useOverlayStore.getState().violation
    if (previous === violation) return
    if (previous && violation && JSON.stringify(previous) === JSON.stringify(violation)) return
    useOverlayStore.setState({ violation })
  },
  toggleHelp() {
    useOverlayStore.setState((s) => ({ helpOpen: !s.helpOpen }))
  },
  setHelpOpen(helpOpen: boolean) {
    useOverlayStore.setState({ helpOpen })
  },
}
