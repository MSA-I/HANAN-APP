import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { outlineAABB, type AABB } from '../core/layout/bounds'
import { childSortKey, type Id, type SceneObject, type SceneState, type Transform2D } from '../core/model/types'
import { composeTransform } from '../core/space'

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

/** Own lock flag OR the object's category layer is locked. */
export function isEffectivelyLocked(scene: SceneState, obj: SceneObject): boolean {
  if (obj.flags.locked) return true
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
