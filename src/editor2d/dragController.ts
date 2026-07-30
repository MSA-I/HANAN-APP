/**
 * Object drag orchestration: multi-selection movement, snapping against
 * neighbors + venue + grid, guide feedback, and one-undo-entry gestures.
 * Konva moves the grabbed node natively; the store is written every dragmove
 * so the 3D view follows live.
 */
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { aabbUnion, type AABB } from '../core/layout/bounds'
import { collectSnapLines, snapAABB, type SnapLines } from '../core/layout/snapping'
import type { Id } from '../core/model/types'
import { rotateVec } from '../core/space'
import {
  beginGesture,
  duplicateObjects,
  endGesture,
  moveObjectsBy,
  select,
  toggleSelect,
} from '../state/actions'
import { isEffectivelyLocked, isTable, objectAABB, visibleTopLevelIds } from '../state/selectors'
import { setDesignEditTable, useEditorStore } from '../state/store'
import { overlay } from './overlayStore'
import { useViewportStore } from './viewportStore'

let ctx: { ids: Id[]; lines: SnapLines } | null = null
let childCtx: { id: Id; parentRotation: number } | null = null

/**
 * The id the shift+mousedown of the CURRENT press just added to the selection.
 *
 * Shift+mousedown has to ADD (or a shift-drag would move only the object under the
 * pointer instead of the whole set) while shift+CLICK has to REMOVE — and the two
 * fire one after the other on the same press. Without this, adding an object with
 * shift+click would immediately un-add it. Every mousedown re-answers the question,
 * so a shift-DRAG — which fires no click at all — cannot leave the flag standing
 * for the next press.
 */
let shiftAdded: Id | null = null

export function onObjectMouseDown(id: Id, e: KonvaEventObject<MouseEvent>): void {
  if (e.evt.button !== 0) return
  e.cancelBubble = true
  shiftAdded = null
  const { selection, scene } = useEditorStore.getState()
  if (e.evt.shiftKey) {
    if (!selection.includes(id) && scene.objects[id]) {
      shiftAdded = id
      select([...selection, id])
    }
    return
  }
  if (!selection.includes(id) && scene.objects[id]) select([id])
}

/**
 * Shift+click toggles — INCLUDING the last object left selected.
 *
 * The guard used to be `selection.length > 1`, which made the final object the one
 * thing shift-click could not release, while 3D calls `toggleSelect` and empties
 * the selection without complaint. The same gesture answering differently in the
 * two views is this repo's most expensive bug class, so 2D now goes through the
 * same action rather than through a second rule that happens to disagree.
 */
export function onObjectClick(id: Id, e: KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true
  if (!e.evt.shiftKey) return
  const added = shiftAdded
  shiftAdded = null
  // this click is the tail of the mousedown that just added it
  if (added === id) return
  toggleSelect(id)
}

/**
 * Double-click a TABLE to isolate it for decor editing (source doc §52).
 *
 * Anything that is not a table ignores the gesture rather than opening a mode
 * with nothing to arrange; the preceding mousedown has already selected it
 * either way. The gesture aimed at a table's DECOR arrives at
 * `onChildDblClick` instead — see the note there, it is not a corner case.
 *
 * The mode is exited by Esc, by a click on empty canvas (Stage2D), and — because
 * the id is validated on read — by deleting the table or switching project.
 */
export function onObjectDblClick(id: Id, e: KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true
  const obj = useEditorStore.getState().scene.objects[id]
  if (!obj || obj.parentId || !isTable(obj)) return
  setDesignEditTable(id)
}

export function onObjectDragStart(id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  shiftAdded = null
  const state = useEditorStore.getState()
  let sel = state.selection
  if (!sel.includes(id)) {
    sel = [id]
    select(sel)
  }
  const ids = sel.filter((sid) => {
    const o = state.scene.objects[sid]
    return o && !o.parentId && !isEffectivelyLocked(state.scene, o)
  })
  // hidden objects are not snap targets — only what the user can see guides them
  const staticBoxes = visibleTopLevelIds(state.scene)
    .filter((oid) => !ids.includes(oid))
    .map((oid) => objectAABB(state.scene, oid))
    .filter((b): b is AABB => !!b)
  const venue = state.scene.venue.size
  staticBoxes.push({ minX: 0, minY: 0, maxX: venue.width, maxY: venue.depth })
  ctx = { ids, lines: collectSnapLines(staticBoxes) }
  beginGesture()
  /**
   * ALT+drag duplicates, and snap-bypass moved to CTRL to make room for it.
   *
   * This pair was the other way round for one commit, on the reasoning that Alt
   * was already taken. The user was asked which he wanted and chose ALT for the
   * copy — it is what every design tool he uses does — so the bypass is what moved.
   *
   * ⚠ `altKey` has a THIRD reader that is NOT this one: `commitPlacement3D(...,
   * event.nativeEvent.altKey, ...)` means "keep the ghost armed after the drop".
   * The two never collide, because a move-drag cannot start while a ghost is armed
   * (`handlePointerDown` bails on `placing`) and no placement click happens while
   * one is not. Do not "unify" them.
   *
   * The copies are made IN PLACE and the ORIGINALS are what travel. Konva is
   * already dragging the original nodes; handing the pointer to a different node
   * mid-gesture is where this normally goes wrong, and the user cannot tell the
   * difference between "the copy moved" and "the original moved" anyway.
   *
   * Two traps, both real:
   *  - `duplicateObjects` ends with `select(newIds)`, which would give the drag's
   *    selection to the copies parked at the start point — so the originals are
   *    re-selected on the next line;
   *  - the call must land AFTER `beginGesture()`, or the duplication and the move
   *    are two undo entries and Ctrl+Z leaves a copy behind.
   *
   * The snap lines above were collected before the copies existed, which is the
   * behaviour we want: lines through objects sitting exactly under the pointer
   * would glue the drag to its own starting point.
   */
  if (e.evt.altKey) {
    duplicateObjects(ctx.ids, { x: 0, y: 0 })
    select(ctx.ids)
  }
}

export function onObjectDragMove(id: Id, e: KonvaEventObject<DragEvent>): void {
  if (!ctx) return
  const node = e.target as Konva.Group
  const state = useEditorStore.getState()
  const obj = state.scene.objects[id]
  if (!obj) return

  const nodePos = node.position()
  let delta = { x: nodePos.x - obj.transform.position.x, y: nodePos.y - obj.transform.position.y }

  const boxes = ctx.ids
    .map((oid) => objectAABB(state.scene, oid))
    .filter((b): b is AABB => !!b)
  // CTRL, not Alt — Alt now makes a copy. Mirrored in ObjectGroup.tsx for 3D.
  if (boxes.length && !(e.evt.ctrlKey || e.evt.metaKey)) {
    const union = aabbUnion(boxes)
    const moved: AABB = {
      minX: union.minX + delta.x,
      minY: union.minY + delta.y,
      maxX: union.maxX + delta.x,
      maxY: union.maxY + delta.y,
    }
    const { settings } = state.scene
    const zoom = useViewportStore.getState().zoom
    const snap = snapAABB(
      moved,
      ctx.lines,
      8 / zoom,
      settings.snapEnabled ? settings.gridSize : null,
    )
    delta = { x: delta.x + snap.dx, y: delta.y + snap.dy }
    overlay.setGuides(snap.guideX, snap.guideY)
    overlay.setDragBox({
      minX: moved.minX + snap.dx,
      minY: moved.minY + snap.dy,
      maxX: moved.maxX + snap.dx,
      maxY: moved.maxY + snap.dy,
    })
  } else if (boxes.length) {
    const union = aabbUnion(boxes)
    overlay.setGuides(null, null)
    overlay.setDragBox({
      minX: union.minX + delta.x,
      minY: union.minY + delta.y,
      maxX: union.maxX + delta.x,
      maxY: union.maxY + delta.y,
    })
  }

  if (delta.x !== 0 || delta.y !== 0) moveObjectsBy(ctx.ids, delta)
  const committed = useEditorStore.getState().scene.objects[id]
  if (committed) node.position({ x: committed.transform.position.x, y: committed.transform.position.y })
}

export function onObjectDragEnd(_id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  ctx = null
  overlay.clearDragVisuals()
  endGesture()
}

// ---------------------------------------------------------------------------
// attached children. Two ways one becomes grabbable: drilling into a chair
// (dbl-click, always available), or opening design-edit mode on its table, which
// hands every piece of decor straight over. A child that is neither still lets
// a plain click fall through and select the parent table.
// ---------------------------------------------------------------------------

export function onChildMouseDown(id: Id, grabbable: boolean, e: KonvaEventObject<MouseEvent>): void {
  if (e.evt.button !== 0) return
  // Not grabbable: let it bubble, so a single click behaves like the table.
  if (!grabbable) return
  // A grabbable child keeps focus and starts its own drag — stop the event so
  // the parent table's mousedown doesn't reselect the table.
  e.cancelBubble = true
  // …and bring the selection with the press. In design-edit mode this is the
  // only thing that selects the decor (there is no drill-in dbl-click to do it),
  // and the inspector, Delete and the rotate gizmo all read the selection. For a
  // drilled-in chair `grabbable` already means selected, so this is a no-op.
  if (!useEditorStore.getState().selection.includes(id)) select([id])
}

/**
 * A child swallows the double-click before the table under it ever sees it
 * (`e.cancelBubble`), so this is also the way INTO design-edit mode for the most
 * likely aim there is.
 *
 * ⚠ Every `placement: 'surface'` entry in the catalog is `surfaceAnchor: 'center'`
 * (`06-collision-api.md §3.1`), which means a hand-placed centrepiece sits dead
 * on the middle of the table — the biggest, most inviting target on it. Aiming
 * there and getting nothing is what a user (and a verification script) will do
 * first. So decor opens the mode on its PARENT and stays selected, ready to drag.
 *
 * A chair is left exactly as it was: `kind: 'seat'` still means "drill into this
 * chair", which is the behaviour PLAN-05 builds on. This adds a branch, it does
 * not take one away.
 */
export function onChildDblClick(id: Id, e: KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true
  const { scene } = useEditorStore.getState()
  const child = scene.objects[id]
  const parent = child?.parentId ? scene.objects[child.parentId] : null
  if (child?.attachment?.kind === 'surface' && parent && !parent.parentId && isTable(parent)) {
    setDesignEditTable(parent.id)
  }
  select([id])
}

export function onChildDragStart(id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  const state = useEditorStore.getState()
  const obj = state.scene.objects[id]
  const parent = obj?.parentId ? state.scene.objects[obj.parentId] : null
  childCtx = { id, parentRotation: parent?.transform.rotation ?? 0 }
  beginGesture()
}

export function onChildDragMove(id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  if (!childCtx) return
  const node = e.target as Konva.Group
  const obj = useEditorStore.getState().scene.objects[id]
  if (!obj) return
  // node.position() is PARENT-LOCAL; moveObjectsBy wants a WORLD delta and
  // converts back to local internally. Rotate the local delta into world by the
  // parent's rotation so a chair on a rotated table tracks the pointer exactly.
  const nodePos = node.position()
  const localDelta = { x: nodePos.x - obj.transform.position.x, y: nodePos.y - obj.transform.position.y }
  if (localDelta.x !== 0 || localDelta.y !== 0) {
    moveObjectsBy([id], rotateVec(localDelta, childCtx.parentRotation))
  }
  const committed = useEditorStore.getState().scene.objects[id]
  if (committed) node.position({ x: committed.transform.position.x, y: committed.transform.position.y })
}

export function onChildDragEnd(_id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  childCtx = null
  // The refusal explained a gesture that is now over. `mutateScene` only clears
  // it on the next SUCCESSFUL write, so leaving it standing would keep the red
  // sibling outline (ObjectNode) lit long after the drag — feedback that outlives
  // its gesture reads as a broken item rather than as a reason.
  overlay.setViolation(null)
  endGesture()
}
