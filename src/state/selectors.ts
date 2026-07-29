import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { outlineAABB, type AABB } from '../core/layout/bounds'
import {
  childSortKey,
  DEFAULT_LIGHTING,
  type Id,
  type LightingSettings,
  type SceneObject,
  type SceneState,
  type Transform2D,
} from '../core/model/types'
import { composeTransform } from '../core/space'

/** The scene's outdoor lighting; pre-v5 scenes have none stored. */
export function lightingOf(scene: SceneState): LightingSettings {
  return scene.settings.lighting ?? DEFAULT_LIGHTING
}

/** World transform of any object (attached chairs compose with their table). */
export function worldTransform(scene: SceneState, id: Id): Transform2D | null {
  const obj = scene.objects[id]
  if (!obj) return null
  if (!obj.parentId) return obj.transform
  const parent = scene.objects[obj.parentId]
  return parent ? composeTransform(parent.transform, obj.transform) : obj.transform
}

export function objectAABB(scene: SceneState, id: Id): AABB | null {
  const obj = scene.objects[id]
  const world = worldTransform(scene, id)
  if (!obj || !world) return null
  const outline = getCatalogEntry(obj.catalogId).footprint(obj.size).outline
  return outlineAABB(world, outline)
}

export function childrenOf(scene: SceneState, id: Id): SceneObject[] {
  return Object.values(scene.objects)
    .filter((o) => o.parentId === id)
    .sort((a, b) => childSortKey(a) - childSortKey(b))
}

/** Surface decor standing on this object's top (attachment kind 'surface'). */
export function surfaceChildren(scene: SceneState, id: Id): SceneObject[] {
  return Object.values(scene.objects).filter(
    (o) => o.parentId === id && o.attachment?.kind === 'surface',
  )
}

// --- design-edit mode (source doc §11 + §52) --------------------------------

/**
 * A table — the thing a double-click may isolate. `seating` is the test rather
 * than `category === 'tables'` because it is the capability the mode needs (a
 * top with chairs around it), and the two are the same six entries today
 * (`catalog/entries/tables.ts`).
 */
export function isTable(obj: SceneObject): boolean {
  return hasCatalogEntry(obj.catalogId) && !!getCatalogEntry(obj.catalogId).seating
}

/**
 * The table currently isolated for decor editing, or null.
 *
 * ⚠ EVERY reader goes through this, never through `state.designEditTableId`.
 * The raw field is a view preference outside `scene`, and the two events that
 * must close the mode — loading another project and deleting the table — both
 * happen in `actions.ts`, which this plan does not own. Validating on read means
 * a leftover id is simply not observable, instead of five writers each having to
 * remember to clear it. The same reasoning `pruneSelection` applies to
 * `selection`, minus the write.
 *
 * Hidden counts as gone: if the tables layer is switched off there is nothing on
 * screen to isolate, and an invisible mode with a dimmed plan reads as a bug.
 */
export function designEditTable(scene: SceneState, id: Id | null): Id | null {
  if (!id) return null
  const obj = scene.objects[id]
  if (!obj || obj.parentId) return null
  if (!isTable(obj) || !isObjectVisible(scene, id)) return null
  return id
}

/**
 * The isolated group: the edited table followed by its children (chairs and
 * decor), in render order. Empty when no session is open — so `length > 0` is
 * "the mode is on" and the caller needs no second question.
 */
export function designEditIds(scene: SceneState, id: Id | null): Id[] {
  const tableId = designEditTable(scene, id)
  if (!tableId) return []
  return [tableId, ...childrenOf(scene, tableId).map((c) => c.id)]
}

/**
 * Is this object outside the isolated group — one of the ones the mode dims and
 * stops listening to? False whenever no session is open, so the ordinary plan is
 * never muted by accident.
 *
 * ⚠ `editTableId` is the id ALREADY through `designEditTable`, not the raw store
 * field. Taking the validated id (rather than validating again here) is what lets
 * a renderer subscribe once and ask this per node.
 *
 * Only top-level objects need asking: a child renders inside its parent's Konva
 * group and inherits both its opacity and its `listening`.
 */
export function isDesignEditMuted(editTableId: Id | null, objId: Id): boolean {
  return editTableId !== null && editTableId !== objId
}

/**
 * A COVER — the place setting itself, the one thing on a table top the mode may
 * NOT rearrange (source doc §11, in the user's words: "אסור שיהיה אפשר לערוך
 * ערכות סכום"). It is laid one per seat by `laySeatItems`, and where it sits is
 * the seat's business, not the arranger's.
 *
 * The CATALOG is the discriminator, never the id. Two properties say it:
 *
 *   placement: 'seat'   laid one per cover, not dropped where the pointer is.
 *   no `requiresHost`   it stands on the cloth ITSELF. The napkins are
 *                       `placement: 'seat'` too — but each names the cover it is
 *                       laid ON (`requiresHost: 'decor.place-setting'`), which is
 *                       exactly what makes a napkin decor rather than the setting.
 *
 * So this reads "the seat-placed piece that stands on the cloth", and it picks
 * out `decor.place-setting` today without any renderer having to name it. A
 * second cover added to the catalogue is covered the day it is added.
 */
export function isCover(obj: SceneObject): boolean {
  if (!hasCatalogEntry(obj.catalogId)) return false
  const entry = getCatalogEntry(obj.catalogId)
  return entry.placement === 'seat' && !entry.requiresHost
}

/**
 * May design-edit mode pick this table-top child up? Everything standing on the
 * top except the cover: the napkins laid on it, the centrepieces beside it.
 *
 * ⚠ BOTH renderers ask this one question — editor2d/ObjectNode.tsx (`editableDecor`)
 * and viewer3d/ObjectGroup.tsx (`SurfaceChild`) — because a rule wired into only
 * one of them means the same place setting is locked in the plan and draggable in
 * 3D. The chairs never reach here: they are `kind: 'seat'` attachments and stay on
 * their drill-in path.
 *
 * Deliberately a RENDERER gate and not an `actions.ts` one: `moveObjectsBy` must
 * keep moving a cover, because that is how `laySeatItems`, the clamps and the
 * collision tests place them in the first place.
 */
export function isArrangeableDecor(obj: SceneObject): boolean {
  return obj.attachment?.kind === 'surface' && !isCover(obj)
}

// --- category layers --------------------------------------------------------

export function categoryOf(obj: SceneObject): Category | null {
  return hasCatalogEntry(obj.catalogId) ? getCatalogEntry(obj.catalogId).category : null
}

export function isLayerHidden(scene: SceneState, category: Category): boolean {
  return !!scene.settings.layers?.[category]?.hidden
}

export function isLayerLocked(scene: SceneState, category: Category): boolean {
  return !!scene.settings.layers?.[category]?.locked
}

/**
 * A baked venue fixture. Unlike `locked` this has no UI that can clear it — it
 * is the "cannot be moved or removed" half of the bake button (source doc §16).
 */
export function isFrozen(obj: SceneObject): boolean {
  return obj.flags.frozen === true
}

/** Frozen, own lock flag, OR the object's category layer is locked. */
export function isEffectivelyLocked(scene: SceneState, obj: SceneObject): boolean {
  if (isFrozen(obj) || obj.flags.locked) return true
  const cat = categoryOf(obj)
  return cat ? isLayerLocked(scene, cat) : false
}

/**
 * Own visible flag + own category layer + every ancestor visible. Hiding the
 * tables layer therefore hides a table AND its attached chairs/decor; hiding
 * the seating layer hides only the chairs.
 */
export function isObjectVisible(scene: SceneState, id: Id): boolean {
  let current: SceneObject | undefined = scene.objects[id]
  while (current) {
    if (current.flags.visible === false) return false
    const cat = categoryOf(current)
    if (cat && isLayerHidden(scene, cat)) return false
    current = current.parentId ? scene.objects[current.parentId] : undefined
  }
  return true
}

/** objectOrder filtered to visible objects — the single render/hit-test cut. */
export function visibleTopLevelIds(scene: SceneState): Id[] {
  return scene.objectOrder.filter((id) => isObjectVisible(scene, id))
}

/** Objects per category, children included (matches what the eye toggle affects). */
export function categoryCounts(scene: SceneState): Partial<Record<Category, number>> {
  const out: Partial<Record<Category, number>> = {}
  for (const obj of Object.values(scene.objects)) {
    const cat = categoryOf(obj)
    if (cat) out[cat] = (out[cat] ?? 0) + 1
  }
  return out
}

export interface SceneCounts {
  tables: number
  chairs: number
  seats: number
}

export function sceneCounts(scene: SceneState): SceneCounts {
  let tables = 0
  let chairs = 0
  let seats = 0
  for (const obj of Object.values(scene.objects)) {
    const entry = getCatalogEntry(obj.catalogId)
    if (entry.seating) {
      tables++
      seats += obj.seating?.count ?? 0
    }
    if (entry.category === 'seating') {
      chairs++
      if (!obj.parentId) seats++
    }
  }
  return { tables, chairs, seats }
}
