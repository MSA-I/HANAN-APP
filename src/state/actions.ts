/**
 * Every mutation of the editor state goes through these actions — the single
 * write path is what keeps undo, seat reconciliation and 2D/3D sync coherent.
 */
import { getCatalogEntry } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { createObject, createProject, newId, type NewProjectOptions } from '../core/model/factory'
import { attachedChairs, reconcileSeats } from '../core/model/seatingReconciler'
import type {
  Id,
  Project,
  SceneObject,
  SceneSettings,
  SceneState,
  SeatingConfig,
  Size3D,
  Vec2,
} from '../core/model/types'
import { composeTransform, normalizeDeg, relativeTransform, rotateVec } from '../core/space'
import { aabbUnion, type AABB } from '../core/layout/bounds'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import {
  childrenOf,
  isEffectivelyLocked,
  isObjectVisible,
  objectAABB as objectAABBOf,
  surfaceChildren,
} from './selectors'
import { temporalStore, useEditorStore, type EditorState, type ViewMode } from './store'

const set = useEditorStore.setState
const get = useEditorStore.getState

function mutateScene(fn: (scene: SceneState, state: EditorState) => void): void {
  set((state) => {
    fn(state.scene, state)
    state.dirty = true
  })
}

function clampSize(catalogId: string, size: Size3D): Size3D {
  const entry = getCatalogEntry(catalogId)
  const clamp = (v: number, min?: number, max?: number) =>
    Math.min(max ?? Infinity, Math.max(min ?? 1, v))
  const out: Size3D = {
    width: clamp(size.width, entry.minSize.width, entry.maxSize.width),
    depth: clamp(size.depth, entry.minSize.depth, entry.maxSize.depth),
    height: clamp(size.height, entry.minSize.height, entry.maxSize.height),
  }
  if (entry.linkWidthDepth) out.depth = out.width
  return out
}

/** ids expanded so that locked objects (own flag or locked category layer) are filtered out */
function editable(scene: SceneState, ids: Id[]): SceneObject[] {
  return ids
    .map((id) => scene.objects[id])
    .filter((o): o is SceneObject => !!o && !isEffectivelyLocked(scene, o))
}

/** Footprint of a top-level object including its attached chairs (world/plan). */
function subtreeAABB(scene: SceneState, id: Id): AABB | null {
  const boxes: AABB[] = []
  const self = objectAABBOf(scene, id)
  if (self) boxes.push(self)
  for (const chair of attachedChairs(scene, id)) {
    const b = objectAABBOf(scene, chair.id)
    if (b) boxes.push(b)
  }
  return boxes.length ? aabbUnion(boxes) : null
}

/** Shift needed to bring a box back onto the floor [0,width]×[0,depth]. */
function floorShift(box: AABB, width: number, depth: number): Vec2 {
  let x = 0
  let y = 0
  if (box.minX < 0) x = -box.minX
  else if (box.maxX > width) x = width - box.maxX
  if (box.minY < 0) y = -box.minY
  else if (box.maxY > depth) y = depth - box.maxY
  return { x, y }
}

/**
 * Shift to push a box out of a restricted zone. Prefers the smallest exit that
 * still leaves the box on the floor — so an object dropped near the pool's short
 * edge exits toward the open side instead of jamming against the wall.
 */
function zonePush(box: AABB, z: RestrictedZone, width: number, depth: number): Vec2 {
  const zx1 = z.x + z.width
  const zy1 = z.y + z.depth
  if (!(box.minX < zx1 && box.maxX > z.x && box.minY < zy1 && box.maxY > z.y)) return { x: 0, y: 0 }
  const exits: Vec2[] = [
    { x: -(box.maxX - z.x), y: 0 }, // left
    { x: zx1 - box.minX, y: 0 }, // right
    { x: 0, y: -(box.maxY - z.y) }, // up
    { x: 0, y: zy1 - box.minY }, // down
  ]
  const onFloor = (s: Vec2) =>
    box.minX + s.x >= -0.01 && box.maxX + s.x <= width + 0.01 &&
    box.minY + s.y >= -0.01 && box.maxY + s.y <= depth + 0.01
  const mag = (s: Vec2) => Math.abs(s.x) + Math.abs(s.y)
  const fitting = exits.filter(onFloor)
  return (fitting.length ? fitting : exits).reduce((a, b) => (mag(b) < mag(a) ? b : a))
}

/** Shift to keep a box INSIDE a zone rectangle (a fixed station in its home zone). */
function zoneShift(box: AABB, z: RestrictedZone): Vec2 {
  let x = 0
  let y = 0
  if (box.minX < z.x) x = z.x - box.minX
  else if (box.maxX > z.x + z.width) x = z.x + z.width - box.maxX
  if (box.minY < z.y) y = z.y - box.minY
  else if (box.maxY > z.y + z.depth) y = z.y + z.depth - box.maxY
  return { x, y }
}

/**
 * HARD bounds enforcement. Shifts each touched TOP-LEVEL object so its footprint
 * (table + chairs) stays on the venue floor and off any restricted zone (pool…).
 * Fixed stations (entry.zoneKind: bar, DJ booth) are the exception: they are
 * clamped INTO their matching zone and can never leave it. The single write path
 * means this catches drag, paste, duplicate, arrow-nudge, resize and rotate in
 * one place. Attached chairs follow their clamped table, so we skip them here.
 * Objects larger than the venue align to the near edge.
 */
function clampToVenue(scene: SceneState, ids: Iterable<Id>): void {
  const { width, depth } = scene.venue.size
  const zones = getVenuePack(scene.venue.venuePackId)?.restricted ?? []
  const done = new Set<Id>()
  const shift = (obj: SceneObject, box: AABB, d: Vec2): AABB => {
    obj.transform.position.x += d.x
    obj.transform.position.y += d.y
    return { minX: box.minX + d.x, minY: box.minY + d.y, maxX: box.maxX + d.x, maxY: box.maxY + d.y }
  }
  for (const id of ids) {
    const obj = scene.objects[id]
    if (!obj || obj.parentId || isEffectivelyLocked(scene, obj) || done.has(id)) continue
    done.add(id)
    let box = subtreeAABB(scene, id)
    if (!box) continue
    let d = floorShift(box, width, depth)
    if (d.x || d.y) box = shift(obj, box, d)

    // fixed station: snap into the nearest matching home zone and stop there
    const zoneKind = getCatalogEntry(obj.catalogId).zoneKind
    const home = zoneKind ? zones.filter((z) => z.kind === zoneKind) : []
    if (home.length) {
      const center = (z: RestrictedZone) => ({ x: z.x + z.width / 2, y: z.y + z.depth / 2 })
      const bc = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }
      const nearest = home.reduce((a, b) => {
        const da = Math.hypot(center(a).x - bc.x, center(a).y - bc.y)
        const db = Math.hypot(center(b).x - bc.x, center(b).y - bc.y)
        return db < da ? b : a
      })
      d = zoneShift(box, nearest)
      if (d.x || d.y) shift(obj, box, d)
      continue
    }

    for (const z of zones) {
      const p = zonePush(box, z, width, depth)
      if (!p.x && !p.y) continue
      box = shift(obj, box, p)
      d = floorShift(box, width, depth) // re-seat on the floor if the push crossed an edge
      if (d.x || d.y) box = shift(obj, box, d)
    }
  }
}

/**
 * Keep a surface-attached decor inside its parent's top outline, standing on the
 * parent's height. Positions are parent-local, so a circular table is a radial
 * clamp and a rect table a per-axis clamp; a rotated rect decor is bounded by
 * its circumradius (conservative, keeps the math simple).
 */
function clampToSurface(scene: SceneState, child: SceneObject): void {
  if (child.attachment?.kind !== 'surface' || !child.parentId) return
  const parent = scene.objects[child.parentId]
  if (!parent) return
  const pOutline = getCatalogEntry(parent.catalogId).footprint(parent.size).outline
  const cOutline = getCatalogEntry(child.catalogId).footprint(child.size).outline
  let hw = cOutline.kind === 'circle' ? cOutline.r : cOutline.w / 2
  let hh = cOutline.kind === 'circle' ? cOutline.r : cOutline.h / 2
  if (cOutline.kind === 'rect' && normalizeDeg(child.transform.rotation) !== 0) {
    hw = hh = Math.hypot(hw, hh)
  }
  const pos = child.transform.position
  if (pOutline.kind === 'circle') {
    const maxR = Math.max(0, pOutline.r - Math.max(hw, hh))
    const len = Math.hypot(pos.x, pos.y)
    if (len > maxR) {
      const f = len > 0 ? maxR / len : 0
      pos.x *= f
      pos.y *= f
    }
  } else {
    const maxX = Math.max(0, pOutline.w / 2 - hw)
    const maxY = Math.max(0, pOutline.h / 2 - hh)
    pos.x = Math.min(maxX, Math.max(-maxX, pos.x))
    pos.y = Math.min(maxY, Math.max(-maxY, pos.y))
  }
  child.transform.elevation = parent.size.height
}

function clampSurfaceChildrenIn(scene: SceneState, ids: Iterable<Id>): void {
  for (const id of ids) {
    const obj = scene.objects[id]
    if (obj?.attachment?.kind === 'surface') clampToSurface(scene, obj)
  }
}

// ---------------------------------------------------------------------------
// project lifecycle
// ---------------------------------------------------------------------------

export function loadProject(p: Project): void {
  set((state) => {
    state.scene = p.scene
    state.selection = []
    state.projectId = p.id
    state.projectName = p.name
    state.eventName = p.eventName
    state.eventDate = p.eventDate
    state.createdAt = p.createdAt
    state.dirty = false
  })
  temporalStore.getState().clear()
}

export function newProject(opts: NewProjectOptions): Project {
  const p = createProject(opts)
  loadProject(p)
  return p
}

/** Return to the dashboard (caller is responsible for flushing a save first). */
export function closeProject(): void {
  set((state) => {
    state.projectId = null
    state.selection = []
  })
  temporalStore.getState().clear()
}

export function setProjectName(name: string): void {
  set((state) => {
    state.projectName = name
    state.dirty = true
  })
}

// ---------------------------------------------------------------------------
// object lifecycle
// ---------------------------------------------------------------------------

export function addObject(catalogId: string, position: Vec2): Id {
  const obj = createObject(catalogId, position)
  mutateScene((scene) => {
    if (obj.seating) {
      const numbers = Object.values(scene.objects)
        .filter((o) => o.seating)
        .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0))
      obj.meta.number = Math.max(0, ...numbers) + 1
    }
    scene.objects[obj.id] = obj
    scene.objectOrder.push(obj.id)
    unhideCategoryOf(scene, obj.catalogId)
    if (obj.seating) reconcileSeats(scene, obj.id)
    clampToVenue(scene, [obj.id])
  })
  select([obj.id])
  return obj.id
}

/**
 * Drop a surface-placement catalog item onto a table top. `worldPos` is the drop
 * point in plan space; the object becomes an attached child (kind 'surface'),
 * standing on the parent's height and clamped to its outline.
 */
export function addObjectToSurface(catalogId: string, parentId: Id, worldPos: Vec2): Id | null {
  const obj = createObject(catalogId, { x: 0, y: 0 })
  let placed = false
  mutateScene((scene) => {
    const parent = scene.objects[parentId]
    if (!parent || parent.parentId) return
    const local = relativeTransform(parent.transform, {
      position: worldPos,
      rotation: parent.transform.rotation,
      elevation: 0,
    })
    obj.parentId = parentId
    obj.attachment = { kind: 'surface' }
    obj.transform = { position: local.position, rotation: 0, elevation: parent.size.height }
    scene.objects[obj.id] = obj
    unhideCategoryOf(scene, obj.catalogId)
    clampToSurface(scene, obj)
    placed = true
  })
  if (!placed) return null
  select([obj.id])
  return obj.id
}

export function removeObjects(ids: Id[]): void {
  mutateScene((scene) => {
    const toReconcile = new Set<Id>()
    for (const id of ids) {
      const obj = scene.objects[id]
      if (!obj) continue
      // locked (own flag or layer) protects from deletion too — unlock first
      if (isEffectivelyLocked(scene, obj)) continue
      if (obj.parentId && obj.attachment) {
        if (obj.attachment.kind === 'seat') {
          // removing an attached chair = one seat less on its table
          const table = scene.objects[obj.parentId]
          delete scene.objects[id]
          if (table?.seating) {
            table.seating.count = Math.max(0, table.seating.count - 1)
            toReconcile.add(table.id)
          }
        } else {
          delete scene.objects[id]
        }
        continue
      }
      for (const child of childrenOf(scene, id)) delete scene.objects[child.id]
      delete scene.objects[id]
      scene.objectOrder = scene.objectOrder.filter((oid) => oid !== id)
    }
    for (const tableId of toReconcile) reconcileSeats(scene, tableId)
  })
  set((state) => {
    state.selection = state.selection.filter((id) => state.scene.objects[id])
  })
}

export function duplicateObjects(ids: Id[], offset: Vec2 = { x: 50, y: 50 }): Id[] {
  const newIds: Id[] = []
  mutateScene((scene) => {
    for (const id of ids) {
      const src = scene.objects[id]
      if (!src || src.parentId) continue // attached chairs are not duplicated alone
      const copy: SceneObject = JSON.parse(JSON.stringify(src))
      copy.id = newId()
      copy.transform = {
        ...copy.transform,
        position: { x: copy.transform.position.x + offset.x, y: copy.transform.position.y + offset.y },
      }
      if (copy.seating) {
        const numbers = Object.values(scene.objects)
          .filter((o) => o.seating)
          .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0))
        copy.meta.number = Math.max(0, ...numbers) + 1
      }
      scene.objects[copy.id] = copy
      scene.objectOrder.push(copy.id)
      unhideCategoryOf(scene, copy.catalogId)
      for (const child of childrenOf(scene, id)) {
        const childCopy: SceneObject = JSON.parse(JSON.stringify(child))
        childCopy.id = newId()
        childCopy.parentId = copy.id
        scene.objects[childCopy.id] = childCopy
      }
      newIds.push(copy.id)
    }
    clampToVenue(scene, newIds)
  })
  if (newIds.length) select(newIds)
  return newIds
}

export interface Subtree {
  root: SceneObject
  children: SceneObject[]
}

/** Insert cloned subtrees (paste). Positions move by centroid→target or +50cm. */
export function pasteSubtrees(subtrees: Subtree[], target?: Vec2): Id[] {
  if (!subtrees.length) return []
  const cx = subtrees.reduce((a, s) => a + s.root.transform.position.x, 0) / subtrees.length
  const cy = subtrees.reduce((a, s) => a + s.root.transform.position.y, 0) / subtrees.length
  const delta = target ? { x: target.x - cx, y: target.y - cy } : { x: 50, y: 50 }
  const newIds: Id[] = []
  mutateScene((scene) => {
    for (const st of subtrees) {
      const root: SceneObject = JSON.parse(JSON.stringify(st.root))
      root.id = newId()
      root.parentId = null
      delete root.attachment
      root.transform.position.x += delta.x
      root.transform.position.y += delta.y
      if (root.seating) {
        const numbers = Object.values(scene.objects)
          .filter((o) => o.seating)
          .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0))
        root.meta.number = Math.max(0, ...numbers) + 1
      }
      scene.objects[root.id] = root
      scene.objectOrder.push(root.id)
      unhideCategoryOf(scene, root.catalogId)
      for (const child of st.children) {
        const copy: SceneObject = JSON.parse(JSON.stringify(child))
        copy.id = newId()
        copy.parentId = root.id
        scene.objects[copy.id] = copy
      }
      newIds.push(root.id)
    }
    clampToVenue(scene, newIds)
  })
  select(newIds)
  return newIds
}

// ---------------------------------------------------------------------------
// transforms
// ---------------------------------------------------------------------------

export function moveObjectsBy(ids: Id[], delta: Vec2): void {
  mutateScene((scene) => {
    for (const obj of editable(scene, ids)) {
      if (obj.parentId) {
        const parent = scene.objects[obj.parentId]
        const local = parent ? rotateVec(delta, -parent.transform.rotation) : delta
        obj.transform.position.x += local.x
        obj.transform.position.y += local.y
        if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
      } else {
        obj.transform.position.x += delta.x
        obj.transform.position.y += delta.y
      }
    }
    clampToVenue(scene, ids)
    clampSurfaceChildrenIn(scene, ids)
  })
}

export function setPosition(id: Id, position: Vec2): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || isEffectivelyLocked(scene, obj)) return
    obj.transform.position = { ...position }
    if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    clampToVenue(scene, [id])
    clampSurfaceChildrenIn(scene, [id])
  })
}

export function setRotation(id: Id, rotation: number): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || isEffectivelyLocked(scene, obj)) return
    obj.transform.rotation = rotation
    if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    clampToVenue(scene, [id])
    clampSurfaceChildrenIn(scene, [id])
  })
}

export function rotateObjectsBy(ids: Id[], delta: number): void {
  mutateScene((scene) => {
    for (const obj of editable(scene, ids)) {
      obj.transform.rotation += delta
      if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    }
    clampToVenue(scene, ids)
    clampSurfaceChildrenIn(scene, ids)
  })
}

export function setSize(id: Id, size: Partial<Size3D>): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || isEffectivelyLocked(scene, obj)) return
    obj.size = clampSize(obj.catalogId, { ...obj.size, ...size })
    if (obj.seating) reconcileSeats(scene, id)
    clampToVenue(scene, [id])
    // a resized table keeps its decor on the (new) top, at the (new) height
    for (const child of surfaceChildren(scene, id)) clampToSurface(scene, child)
    clampSurfaceChildrenIn(scene, [id])
  })
}

// ---------------------------------------------------------------------------
// seating
// ---------------------------------------------------------------------------

export function setSeatCount(id: Id, count: number): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj?.seating) return
    const cap = getCatalogEntry(obj.catalogId).seating
    obj.seating.count = Math.max(cap?.min ?? 0, Math.min(count, cap?.max ?? count))
    reconcileSeats(scene, id)
  })
}

export function setSeatingConfig(id: Id, patch: Partial<SeatingConfig>): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj?.seating) return
    Object.assign(obj.seating, patch)
    reconcileSeats(scene, id)
  })
}

export function detachChair(chairId: Id): void {
  mutateScene((scene) => {
    const chair = scene.objects[chairId]
    if (!chair?.parentId || !chair.attachment) return
    const table = scene.objects[chair.parentId]
    chair.transform = table ? composeTransform(table.transform, chair.transform) : chair.transform
    chair.parentId = null
    delete chair.attachment
    scene.objectOrder.push(chairId)
    if (table?.seating) {
      table.seating.count = Math.max(0, table.seating.count - 1)
      reconcileSeats(scene, table.id)
    }
  })
}

export function detachAllChairs(tableId: Id): void {
  mutateScene((scene) => {
    const table = scene.objects[tableId]
    if (!table?.seating) return
    for (const chair of attachedChairs(scene, tableId)) {
      chair.transform = composeTransform(table.transform, chair.transform)
      chair.parentId = null
      delete chair.attachment
      scene.objectOrder.push(chair.id)
    }
    table.seating.count = 0
  })
}

// ---------------------------------------------------------------------------
// appearance, naming, flags, order
// ---------------------------------------------------------------------------

export function setAppearance(ids: Id[], slot: string, color: string): void {
  mutateScene((scene) => {
    for (const obj of editable(scene, ids)) {
      obj.appearance[slot] = { color }
    }
  })
}

/** Recolor every chair attached to a table (and remember for future chairs). */
export function setChairAppearance(tableId: Id, slot: string, color: string): void {
  mutateScene((scene) => {
    for (const chair of attachedChairs(scene, tableId)) {
      chair.appearance[slot] = { color }
    }
  })
}

export function setName(id: Id, name: string): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (obj) obj.name = name
  })
}

export function setLocked(ids: Id[], locked: boolean): void {
  mutateScene((scene) => {
    for (const id of ids) {
      const obj = scene.objects[id]
      if (obj) obj.flags.locked = locked
    }
  })
}

export type ReorderOp = 'front' | 'back' | 'forward' | 'backward'

export function reorder(id: Id, op: ReorderOp): void {
  mutateScene((scene) => {
    const idx = scene.objectOrder.indexOf(id)
    if (idx < 0) return
    scene.objectOrder.splice(idx, 1)
    const last = scene.objectOrder.length
    const target =
      op === 'front' ? last : op === 'back' ? 0 : op === 'forward' ? Math.min(idx + 1, last) : Math.max(idx - 1, 0)
    scene.objectOrder.splice(target, 0, id)
  })
}

// ---------------------------------------------------------------------------
// align + distribute
// ---------------------------------------------------------------------------

export type AlignEdge = 'start' | 'centerX' | 'end' | 'top' | 'centerY' | 'bottom'

export function alignObjects(ids: Id[], edge: AlignEdge): void {
  const state = get()
  const boxes = ids
    .map((id) => ({ id, box: objectAABBOf(state.scene, id) }))
    .filter((e): e is { id: Id; box: AABB } => !!e.box)
  if (boxes.length < 2) return
  const minX = Math.min(...boxes.map((b) => b.box.minX))
  const maxX = Math.max(...boxes.map((b) => b.box.maxX))
  const minY = Math.min(...boxes.map((b) => b.box.minY))
  const maxY = Math.max(...boxes.map((b) => b.box.maxY))
  mutateScene((scene) => {
    for (const { id, box } of boxes) {
      const obj = scene.objects[id]
      if (!obj || isEffectivelyLocked(scene, obj) || obj.parentId) continue
      let dx = 0
      let dy = 0
      const cx = (box.minX + box.maxX) / 2
      const cy = (box.minY + box.maxY) / 2
      switch (edge) {
        case 'start':
          dx = minX - box.minX
          break
        case 'centerX':
          dx = (minX + maxX) / 2 - cx
          break
        case 'end':
          dx = maxX - box.maxX
          break
        case 'top':
          dy = minY - box.minY
          break
        case 'centerY':
          dy = (minY + maxY) / 2 - cy
          break
        case 'bottom':
          dy = maxY - box.maxY
          break
      }
      obj.transform.position.x += dx
      obj.transform.position.y += dy
    }
    clampToVenue(scene, ids)
  })
}

export function distributeObjects(ids: Id[], axis: 'x' | 'y'): void {
  const state = get()
  const boxes = ids
    .map((id) => ({ id, box: objectAABBOf(state.scene, id) }))
    .filter((e): e is { id: Id; box: AABB } => !!e.box)
  if (boxes.length < 3) return
  const key = axis === 'x' ? 'minX' : 'minY'
  const sorted = [...boxes].sort(
    (a, b) => (a.box[key] + (axis === 'x' ? a.box.maxX : a.box.maxY)) / 2 -
      (b.box[key] + (axis === 'x' ? b.box.maxX : b.box.maxY)) / 2,
  )
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const firstC = axis === 'x' ? (first.box.minX + first.box.maxX) / 2 : (first.box.minY + first.box.maxY) / 2
  const lastC = axis === 'x' ? (last.box.minX + last.box.maxX) / 2 : (last.box.minY + last.box.maxY) / 2
  const step = (lastC - firstC) / (sorted.length - 1)
  mutateScene((scene) => {
    sorted.forEach(({ id, box }, i) => {
      const obj = scene.objects[id]
      if (!obj || isEffectivelyLocked(scene, obj) || obj.parentId) return
      const c = axis === 'x' ? (box.minX + box.maxX) / 2 : (box.minY + box.maxY) / 2
      const target = firstC + step * i
      if (axis === 'x') obj.transform.position.x += target - c
      else obj.transform.position.y += target - c
    })
    clampToVenue(scene, ids)
  })
}

// ---------------------------------------------------------------------------
// venue + settings
// ---------------------------------------------------------------------------

export function setVenueSize(width: number, depth: number): void {
  mutateScene((scene) => {
    scene.venue.size.width = Math.max(200, width)
    scene.venue.size.depth = Math.max(200, depth)
  })
}

export function setWallHeight(height: number): void {
  mutateScene((scene) => {
    scene.venue.wallHeight = Math.max(100, height)
  })
}

export function setFloorColor(color: string): void {
  mutateScene((scene) => {
    scene.venue.floor.color = color
  })
}

export function updateSettings(patch: Partial<SceneSettings>): void {
  mutateScene((scene) => {
    Object.assign(scene.settings, patch)
  })
}

// ---------------------------------------------------------------------------
// category layers
// ---------------------------------------------------------------------------

/** Set/clear one layer flag, dropping empty records so all-default stays {}. */
function setLayerFlag(
  scene: SceneState,
  category: Category,
  flag: 'hidden' | 'locked',
  value: boolean,
): void {
  const layers = (scene.settings.layers ??= {})
  const entry = layers[category] ?? {}
  if (value) entry[flag] = true
  else delete entry[flag]
  if (entry.hidden || entry.locked) layers[category] = entry
  else delete layers[category]
}

export function setLayerHidden(category: Category, hidden: boolean): void {
  mutateScene((scene) => {
    setLayerFlag(scene, category, 'hidden', hidden)
  })
  // selection is not part of the undoable region — prune like removeObjects does
  if (hidden) {
    set((state) => {
      state.selection = state.selection.filter((id) => isObjectVisible(state.scene, id))
    })
  }
}

export function setLayerLocked(category: Category, locked: boolean): void {
  mutateScene((scene) => {
    setLayerFlag(scene, category, 'locked', locked)
  })
}

/** Placing into a hidden category would look like a silent no-op — unhide it. */
function unhideCategoryOf(scene: SceneState, catalogId: string): void {
  const layers = scene.settings.layers
  if (!layers) return
  const cat = getCatalogEntry(catalogId).category
  const entry = layers[cat]
  if (!entry?.hidden) return
  delete entry.hidden
  if (!entry.locked) delete layers[cat]
}

// ---------------------------------------------------------------------------
// selection + view mode (not undoable, not dirty)
// ---------------------------------------------------------------------------

export function select(ids: Id[]): void {
  set((state) => {
    state.selection = ids
  })
}

export function toggleSelect(id: Id): void {
  set((state) => {
    state.selection = state.selection.includes(id)
      ? state.selection.filter((s) => s !== id)
      : [...state.selection, id]
  })
}

export function clearSelection(): void {
  set((state) => {
    state.selection = []
  })
}

export function setMode(mode: ViewMode): void {
  set((state) => {
    state.mode = mode
  })
}

// ---------------------------------------------------------------------------
// history: gestures + undo/redo
// ---------------------------------------------------------------------------

let gestureBase: SceneState | null = null

/**
 * Wrap a continuous interaction (drag, slider scrub) so the whole gesture is
 * exactly ONE undo entry: history is paused during the gesture, then the
 * base→final transition is re-applied as a single recorded change.
 */
export function beginGesture(): void {
  if (gestureBase) return
  gestureBase = get().scene
  temporalStore.getState().pause()
}

export function endGesture(): void {
  if (!gestureBase) return
  const base = gestureBase
  gestureBase = null
  const finalScene = get().scene
  if (finalScene === base) {
    temporalStore.getState().resume()
    return
  }
  // restore base silently (still paused), then record base→final as one step
  set((state) => {
    state.scene = base
  })
  temporalStore.getState().resume()
  set((state) => {
    state.scene = finalScene
    state.dirty = true
  })
}

export function isGestureActive(): boolean {
  return gestureBase !== null
}

function pruneSelection(): void {
  set((state) => {
    // dropped objects AND objects hidden by an undone/redone layer toggle
    state.selection = state.selection.filter(
      (id) => state.scene.objects[id] && isObjectVisible(state.scene, id),
    )
  })
}

export function undo(): void {
  temporalStore.getState().undo()
  pruneSelection()
}

export function redo(): void {
  temporalStore.getState().redo()
  pruneSelection()
}
