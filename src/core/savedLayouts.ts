/**
 * User-saved arrangements ("פריסות אישיות"): pure snapshot/restore over the
 * scene model, stored in IndexedDB by persistence/indexedDbRepository.
 *
 * Three KINDS share one store and one shape (source doc §24, §32, §23):
 *   'tables'      — the hall's tables, replaces a built-in hall layout
 *   'lighting'    — every ceiling fixture in the scene
 *   'tableDesign' — the decor on ONE table, re-laid on any other table
 *
 * A kind owns its own `meta` tag (LAYOUT_TAG) so a table layout and a lighting
 * layout can be applied at the same time — before v8 both shared `meta.layout`
 * and applying one silently deleted the other.
 */
import { getCatalogEntry, hasCatalogEntry } from './catalog/registry'
import { newId } from './model/factory'
import { childSortKey, type Id, type SceneObject, type SceneState, type Venue } from './model/types'

/** How much of the snapshot is restored: geometry only, or colours + decor too. */
export type SavedLayoutMode = 'layout' | 'layout-design'

export type SavedLayoutKind = 'tables' | 'lighting' | 'tableDesign'

/**
 * The `meta` key each kind tags its instantiated objects with. Separate keys are
 * the whole point: one shared key means one applied layout at a time.
 * `tableDesign` reuses `meta.design`, which the built-in designs already use —
 * a table has exactly one design, so that slot is genuinely single-valued.
 */
export const LAYOUT_TAG = {
  tables: 'layoutTables',
  lighting: 'layoutLighting',
  tableDesign: 'design',
} as const satisfies Record<SavedLayoutKind, string>

/** Bumped when the stored SavedLayout shape changes; see migrateSavedLayout. */
export const LAYOUT_SCHEMA_VERSION = 2

export type VenueSignature =
  | { kind: 'pack'; venuePackId: string }
  | { kind: 'manual'; width: number; depth: number }

export interface SavedLayoutSubtree {
  root: SceneObject
  children: SceneObject[]
}

export interface SavedLayout {
  id: string
  /** LAYOUT_SCHEMA_VERSION at write time; a record without one is version 1 */
  schemaVersion: number
  name: string
  kind: SavedLayoutKind
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

/**
 * v1 → v2: `kind` and `schemaVersion` did not exist. Every v1 record was a hall
 * table layout, so it becomes 'tables'. Records are read straight out of
 * IndexedDB (listLayouts does no zod pass), so anything unrecognisable is
 * dropped rather than handed to the editor.
 */
export function migrateSavedLayout(raw: unknown): SavedLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Partial<SavedLayout> & { schemaVersion?: unknown }
  if (
    typeof record.id !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.createdAt !== 'string' ||
    !Array.isArray(record.subtrees) ||
    !record.venue
  ) {
    return null
  }
  return {
    ...(record as SavedLayout),
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    kind: record.kind ?? 'tables',
    mode: record.mode ?? 'layout-design',
  }
}

/** Catalog ids the snapshot needs that the catalog no longer has. */
export function missingCatalogIds(layout: SavedLayout): string[] {
  const missing = new Set<string>()
  for (const subtree of layout.subtrees) {
    for (const object of [subtree.root, ...subtree.children]) {
      if (!hasCatalogEntry(object.catalogId)) missing.add(object.catalogId)
      const chair = object.seating?.chairCatalogId
      if (chair && !hasCatalogEntry(chair)) missing.add(chair)
    }
  }
  return [...missing]
}

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

function snapshotRoots(scene: SceneState, rootIds: Id[], mode: SavedLayoutMode): SavedLayoutSubtree[] {
  return rootIds.map((id) => {
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

/** Copy selected root subtrees at their authored coordinates. */
export function snapshotSelection(
  scene: SceneState,
  selection: readonly Id[],
  mode: SavedLayoutMode,
): SavedLayoutSubtree[] {
  return snapshotRoots(scene, selectedRootIds(scene, selection), mode)
}

function makeLayout(
  name: string,
  kind: SavedLayoutKind,
  mode: SavedLayoutMode,
  scene: SceneState,
  subtrees: SavedLayoutSubtree[],
  now: string,
): SavedLayout | null {
  const trimmedName = name.trim()
  if (!trimmedName || !subtrees.length) return null
  return {
    id: newId(),
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    name: trimmedName,
    kind,
    mode,
    venue: venueSignature(scene.venue),
    createdAt: now,
    subtrees,
  }
}

export function createSavedLayout(
  name: string,
  scene: SceneState,
  selection: readonly Id[],
  mode: SavedLayoutMode,
  now = new Date().toISOString(),
): SavedLayout | null {
  return makeLayout(name, 'tables', mode, scene, snapshotSelection(scene, selection, mode), now)
}

/**
 * Source doc §32 — the lighting counterpart of a hall layout. Selection-free on
 * purpose: a lighting layout means "how this hall is lit", which is every
 * ceiling fixture in it, not whichever ones happen to be selected.
 */
export function createLightingLayout(
  name: string,
  scene: SceneState,
  now = new Date().toISOString(),
): SavedLayout | null {
  const rootIds = scene.objectOrder.filter((id) => {
    const object = scene.objects[id]
    return !!object && hasCatalogEntry(object.catalogId) &&
      getCatalogEntry(object.catalogId).category === 'lighting'
  })
  return makeLayout(name, 'lighting', 'layout-design', scene, snapshotRoots(scene, rootIds, 'layout-design'), now)
}

/**
 * Source doc §23 — the answer to "we never defined what a table design looks
 * like": arrange the decor on one table by hand, then save that arrangement.
 * Only the table's SURFACE children are captured (chairs belong to the table's
 * seating, not to its design), and the table itself is stored as the root so
 * applying it to a bigger table can scale the offsets — see actions.ts.
 */
export function createTableDesignLayout(
  name: string,
  scene: SceneState,
  tableId: Id,
  now = new Date().toISOString(),
): SavedLayout | null {
  const table = scene.objects[tableId]
  if (!table?.seating || table.parentId) return null
  const children = Object.values(scene.objects)
    .filter((object) => object.parentId === tableId && object.attachment?.kind === 'surface')
    .sort((a, b) => childSortKey(a) - childSortKey(b))
    .map((object) => snapshotObject(object, 'layout-design'))
  if (!children.length) return null
  const root = snapshotObject(table, 'layout-design')
  return makeLayout(name, 'tableDesign', 'layout-design', scene, [{ root, children }], now)
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
  const tag = LAYOUT_TAG[saved.kind]

  for (const subtree of saved.subtrees) {
    const root = clone(subtree.root)
    root.id = newId()
    root.parentId = null
    delete root.attachment
    root.flags = { locked: false, visible: true }
    // drop any tag the snapshot carried (it may have been captured while another
    // layout or hall design was applied) before stamping this layout's own
    root.meta = { ...root.meta }
    delete root.meta.layout
    delete root.meta.layoutTables
    delete root.meta.layoutLighting
    delete root.meta.design
    root.meta[tag] = saved.id
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
