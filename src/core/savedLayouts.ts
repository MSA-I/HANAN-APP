import { newId } from './model/factory'
import { childSortKey, type Id, type SceneObject, type SceneState, type Venue } from './model/types'

export type SavedLayoutMode = 'layout' | 'layout-design'

export type VenueSignature =
  | { kind: 'pack'; venuePackId: string }
  | { kind: 'manual'; width: number; depth: number }

export interface SavedLayoutSubtree {
  root: SceneObject
  children: SceneObject[]
}

export interface SavedLayout {
  id: string
  name: string
  mode: SavedLayoutMode
  venue: VenueSignature
  createdAt: string
  subtrees: SavedLayoutSubtree[]
}

export function venueSignature(venue: Pick<Venue, 'size' | 'venuePackId'>): VenueSignature {
  return venue.venuePackId
    ? { kind: 'pack', venuePackId: venue.venuePackId }
    : { kind: 'manual', width: venue.size.width, depth: venue.size.depth }
}

export function sameVenueSignature(a: VenueSignature, b: VenueSignature): boolean {
  if (a.kind === 'pack') return b.kind === 'pack' && a.venuePackId === b.venuePackId
  return b.kind === 'manual' && a.width === b.width && a.depth === b.depth
}

const clone = <T,>(value: T): T => structuredClone(value)

function selectedRootIds(scene: SceneState, selection: readonly Id[]): Id[] {
  const selected = new Set<Id>()
  for (const id of selection) {
    let object = scene.objects[id]
    if (!object) continue
    while (object.parentId && scene.objects[object.parentId]) object = scene.objects[object.parentId]
    if (!object.parentId) selected.add(object.id)
  }
  return scene.objectOrder.filter((id) => selected.has(id))
}

function snapshotObject(object: SceneObject, mode: SavedLayoutMode): SceneObject {
  const copy = clone(object)
  if (mode === 'layout') copy.appearance = {}
  return copy
}

/** Copy selected root subtrees at their authored coordinates. */
export function snapshotSelection(
  scene: SceneState,
  selection: readonly Id[],
  mode: SavedLayoutMode,
): SavedLayoutSubtree[] {
  return selectedRootIds(scene, selection).map((id) => {
    const root = snapshotObject(scene.objects[id], mode)
    const children = Object.values(scene.objects)
      .filter(
        (object) =>
          object.parentId === id &&
          (mode === 'layout-design' || object.attachment?.kind !== 'surface'),
      )
      .sort((a, b) => childSortKey(a) - childSortKey(b))
      .map((object) => snapshotObject(object, mode))
    return { root, children }
  })
}

export function createSavedLayout(
  name: string,
  scene: SceneState,
  selection: readonly Id[],
  mode: SavedLayoutMode,
  now = new Date().toISOString(),
): SavedLayout | null {
  const trimmedName = name.trim()
  const subtrees = snapshotSelection(scene, selection, mode)
  if (!trimmedName || !subtrees.length) return null
  return {
    id: newId(),
    name: trimmedName,
    mode,
    venue: venueSignature(scene.venue),
    createdAt: now,
    subtrees,
  }
}

/** Insert a saved snapshot into a scene draft, preserving coordinates but refreshing identity. */
export function instantiateSavedLayout(scene: SceneState, saved: SavedLayout): Id[] {
  let nextNumber =
    Math.max(
      0,
      ...Object.values(scene.objects)
        .filter((object) => object.seating)
        .map((object) => (typeof object.meta.number === 'number' ? object.meta.number : 0)),
    ) + 1
  const rootIds: Id[] = []

  for (const subtree of saved.subtrees) {
    const root = clone(subtree.root)
    root.id = newId()
    root.parentId = null
    delete root.attachment
    root.flags = { locked: false, visible: true }
    root.meta = { ...root.meta, layout: saved.id }
    if (root.seating) root.meta.number = nextNumber++
    scene.objects[root.id] = root
    scene.objectOrder.push(root.id)
    rootIds.push(root.id)

    for (const child of subtree.children) {
      const copy = clone(child)
      copy.id = newId()
      copy.parentId = root.id
      copy.flags = { locked: false, visible: true }
      scene.objects[copy.id] = copy
    }
  }
  return rootIds
}
