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
import { beginGesture, endGesture, moveObjectsBy, select } from '../state/actions'
import { objectAABB } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { overlay } from './overlayStore'
import { useViewportStore } from './viewportStore'

let ctx: { ids: Id[]; lines: SnapLines } | null = null
let childCtx: { id: Id; parentRotation: number } | null = null

export function onObjectMouseDown(id: Id, e: KonvaEventObject<MouseEvent>): void {
  if (e.evt.button !== 0) return
  e.cancelBubble = true
  const { selection, scene } = useEditorStore.getState()
  if (e.evt.shiftKey) {
    // toggle handled on click-without-drag; here just make sure it's selectable
    if (!selection.includes(id)) select([...selection, id])
    return
  }
  if (!selection.includes(id) && scene.objects[id]) select([id])
}

export function onObjectClick(id: Id, e: KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true
  const { selection } = useEditorStore.getState()
  if (e.evt.shiftKey && selection.includes(id) && selection.length > 1) {
    select(selection.filter((s) => s !== id))
  }
}

export function onObjectDragStart(id: Id, e: KonvaEventObject<DragEvent>): void {
  e.cancelBubble = true
  const state = useEditorStore.getState()
  let sel = state.selection
  if (!sel.includes(id)) {
    sel = [id]
    select(sel)
  }
  const ids = sel.filter((sid) => {
    const o = state.scene.objects[sid]
    return o && !o.parentId && !o.flags.locked
  })
  const staticBoxes = state.scene.objectOrder
    .filter((oid) => !ids.includes(oid))
    .map((oid) => objectAABB(state.scene, oid))
    .filter((b): b is AABB => !!b)
  const venue = state.scene.venue.size
  staticBoxes.push({ minX: 0, minY: 0, maxX: venue.width, maxY: venue.depth })
  ctx = { ids, lines: collectSnapLines(staticBoxes) }
  beginGesture()
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
  if (boxes.length && !e.evt.altKey) {
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
// attached chairs (drill-in): a chair listens for its own dbl-click + drag,
// but a plain click still falls through to select the parent table.
// ---------------------------------------------------------------------------

export function onChildMouseDown(_id: Id, isSelected: boolean, e: KonvaEventObject<MouseEvent>): void {
  if (e.evt.button !== 0) return
  // A drilled-in chair keeps focus and starts its own drag — stop the event so
  // the parent table's mousedown doesn't reselect the table. When the chair is
  // NOT selected we let it bubble, so a single click behaves like the table.
  if (isSelected) e.cancelBubble = true
}

export function onChildDblClick(id: Id, e: KonvaEventObject<MouseEvent>): void {
  e.cancelBubble = true
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
  endGesture()
}
