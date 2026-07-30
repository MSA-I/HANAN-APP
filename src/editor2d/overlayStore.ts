import { create } from 'zustand'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { AABB } from '../core/layout/bounds'
import type { Violation } from '../core/layout/collision'
import type { Id, Vec2 } from '../core/model/types'

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

/**
 * The live numbers a transform gesture is producing, written every frame by
 * `SelectionTransformer` and cleared when the gesture ends. Null the rest of the
 * time — nothing else may leave a stale readout standing.
 *
 * `at` is a WORLD point the readout hangs off, not the text's own position: the
 * top edge of the transform box for a rotate, the bottom edge for a resize. The
 * few pixels of clearance are applied by `OverlayLayer`, which is where `1 / zoom`
 * already lives — a readout that drifted with the zoom would be the one thing on
 * the canvas that did.
 *
 * SINGLE SELECTION ONLY. "137°" over a group of six tables would be the angle of
 * the group box, which is not a number the user asked for or can act on.
 */
export type GestureReadout =
  | { kind: 'rotate'; deg: number; snapped: boolean; at: Vec2 }
  | { kind: 'resize'; width: number; depth: number; at: Vec2 }

interface OverlayState {
  guides: { x: number | null; y: number | null }
  /** combined AABB of the dragged selection, for wall-distance indicators */
  dragBox: AABB | null
  marquee: Marquee | null
  spacePan: boolean
  /** persistent hand tool (toolbar H) */
  handTool: boolean
  /** the VIEW is being dragged right now — space/hand pan or a middle-drag */
  panning: boolean
  /**
   * Is Shift down, asked of the store rather than of an event.
   *
   * Written by `useEditorShortcuts`' keydown/keyup pair (and cleared on window
   * blur, or alt-tabbing away mid-hold leaves it stuck on). Read by BOTH rotation
   * gizmos to decide whether the 45° snap is engaged: 2D could read
   * `e.evt.shiftKey` off the Konva event, but drei's `TransformControls` hands its
   * callback no DOM event at all, so the 3D half has no other way to ask. One
   * field, so the two views cannot answer the question differently.
   */
  shiftHeld: boolean
  /** the object the pointer is over, or null — see `isHoverSuppressed` */
  hoveredId: Id | null
  /** live readout of the transform gesture in flight */
  gesture: GestureReadout | null
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
  /**
   * Lighting-planning mode, held BY HAND (source doc §33). It is a mode and not a
   * view: `ViewMode` is persisted and drives the whole app layout, so the flag
   * lives here instead.
   *
   * Arming a `lighting` catalog item switches the mode on as well, but that is
   * DERIVED — see `isLightingPlanOn`. Storing the automatic half would mean two
   * fields to keep in step and the classic "turned itself on and stayed on" bug;
   * with one field there is nothing to synchronise.
   */
  lightingPlan: boolean
}

/**
 * Whether the beam grid is showing: pinned by the toolbar, or on for as long as a
 * ceiling fixture is armed for placement — the user asked for it to appear "when
 * I pick lighting in 2D".
 */
export function isLightingPlanOn(s: Pick<OverlayState, 'lightingPlan' | 'placing'>): boolean {
  if (s.lightingPlan) return true
  if (!s.placing || !hasCatalogEntry(s.placing)) return false
  return getCatalogEntry(s.placing).category === 'lighting'
}

/**
 * When the hover outline must not be drawn even though `hoveredId` is set.
 *
 * `hoveredId` keeps tracking through all of these on purpose — it is what the
 * CURSOR reads, and a cursor that forgot what it was over would be worse than one
 * that is briefly overruled by `cursorFor`'s higher ranks. Only the outline is
 * suppressed, and only while the answer it gives would be noise:
 *
 *  - `dragBox` — an object drag is in flight. Konva keeps hit-testing while it
 *    drags, so a fast move sweeps the pointer across neighbours and lights each
 *    one up in turn. (Set for floor drags only; an attached child's drag is over
 *    its own already-selected node, where the hover ring sits under the selection
 *    ring and is invisible either way.)
 *  - `marquee` — a rubber band already says what it will catch.
 *  - `placing` — the ghost is the subject; a second outline competes with it.
 *  - `panning` — the view is moving under a stationary pointer, so every object
 *    that slides past would flash.
 */
export function isHoverSuppressed(
  s: Pick<OverlayState, 'dragBox' | 'marquee' | 'placing' | 'panning'>,
): boolean {
  return s.dragBox !== null || s.marquee !== null || s.placing !== null || s.panning
}

export const useOverlayStore = create<OverlayState>()(() => ({
  guides: { x: null, y: null },
  dragBox: null,
  marquee: null,
  spacePan: false,
  handTool: false,
  panning: false,
  shiftHeld: false,
  hoveredId: null,
  gesture: null,
  placing: null,
  placingPreset: null,
  replaceTarget: null,
  ghost: null,
  cursorWorld: null,
  violation: null,
  helpOpen: false,
  lightingPlan: false,
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
  setPanning(panning: boolean) {
    useOverlayStore.setState({ panning })
  },
  setShiftHeld(shiftHeld: boolean) {
    useOverlayStore.setState({ shiftHeld })
  },
  setHovered(hoveredId: Id | null) {
    // fires on every mouseenter/mouseleave; a no-op write would re-run 350 node
    // selectors for nothing
    if (useOverlayStore.getState().hoveredId === hoveredId) return
    useOverlayStore.setState({ hoveredId })
  },
  /** Only the node that OWNS the hover may release it — see ObjectNode's leave. */
  clearHovered(hoveredId: Id) {
    if (useOverlayStore.getState().hoveredId !== hoveredId) return
    useOverlayStore.setState({ hoveredId: null })
  },
  setGesture(gesture: GestureReadout | null) {
    useOverlayStore.setState({ gesture })
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
  /**
   * Pin/unpin lighting-planning mode. Toggles the MANUAL flag only: pressing the
   * button while the mode is on because a fixture is armed pins it, so it survives
   * the drop instead of vanishing with the ghost.
   */
  toggleLightingPlan() {
    useOverlayStore.setState((s) => ({ lightingPlan: !s.lightingPlan }))
  },
  setLightingPlan(lightingPlan: boolean) {
    useOverlayStore.setState({ lightingPlan })
  },
  toggleHelp() {
    useOverlayStore.setState((s) => ({ helpOpen: !s.helpOpen }))
  },
  setHelpOpen(helpOpen: boolean) {
    useOverlayStore.setState({ helpOpen })
  },
}
