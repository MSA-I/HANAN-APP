import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { Category } from '../core/catalog/types'
import { editableSlotsOf, isFloorTable, slotColor, slotTextureId } from '../core/catalog/types'
import { aabbUnion, outlineAABB, type AABB } from '../core/layout/bounds'
import { maxGapForSeats, maxSeatsForEntry } from '../core/layout/seatLayout'
import { attachedChairs } from '../core/model/seatingReconciler'
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

/**
 * Footprint of a top-level object INCLUDING its attached chairs (world/plan).
 *
 * The box the placement rules actually judge — `objectAABB` above is the outline
 * alone, and for a laid table the two are far apart: measured on the serpentine,
 * 15.9 cm at the west edge and 39.5 cm at the east. Snapping to the outline while
 * the gate measures the subtree is what makes a snap line promise a wall the table
 * then stops 38 cm short of (PLAN-07 §3.6a).
 *
 * Lives here rather than in state/actions.ts, where it was private, because the
 * 2D drag controller is now the second caller. `actions.ts` imports it back.
 */
export function subtreeAABB(scene: SceneState, id: Id): AABB | null {
  const boxes: AABB[] = []
  const self = objectAABB(scene, id)
  if (self) boxes.push(self)
  for (const chair of attachedChairs(scene, id)) {
    const b = objectAABB(scene, chair.id)
    if (b) boxes.push(b)
  }
  return boxes.length ? aabbUnion(boxes) : null
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
 * A COVER — the place setting itself. It is laid one per seat by `laySeatItems`,
 * and where it sits is the seat's business, not the arranger's.
 *
 * ⚠ THIS IS NO LONGER THE DRAG GATE — it is the REFUSAL gate. Since PLAN-10 §4 the
 * cover may be rearranged INSIDE a design-edit session (`canArrangeDecor` owns
 * that), and what this predicate now picks out is the piece whose refused press is
 * SWALLOWED and explained OUTSIDE one. Source doc §11 ("אסור שיהיה אפשר לערוך
 * ערכות סכום") is scoped by the mode, not cancelled.
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
 * May the pointer pick this table-top child up? Everything standing on the top —
 * the napkins, the centrepieces AND the cover — but ONLY while the mode that owns
 * that table is open.
 *
 * ⚠ BOTH renderers ask this one question — editor2d/ObjectNode.tsx and
 * viewer3d/ObjectGroup.tsx (`SurfaceChild`) — because a rule wired into only one
 * of them means the same place setting is locked in the plan and draggable in 3D.
 * The chairs never reach here: they are `kind: 'seat'` attachments and stay on
 * their drill-in path.
 *
 * THE MODE IS THE WHOLE RULE (PLAN-10 §4, the user's 2026-08-02 decision). §11 —
 * "אסור שיהיה אפשר לערוך ערכות סכום" — was not cancelled, it was SCOPED: outside
 * the session a cover still cannot be moved, so sorting the hall cannot nudge one
 * by accident; inside a session, which is entered deliberately on one table with
 * everything else dimmed, it is decor like any other. That is also what finally
 * makes `editMode.hint` ("גררו את הקישוטים למקומם") a true promise.
 *
 * Takes the RAW `designEditTableId` and validates it here — the same shape
 * `isHoverable` uses, so no caller has to remember the two-step.
 *
 * Deliberately a RENDERER gate and not an `actions.ts` one: `moveObjectsBy` must
 * keep moving a cover, because that is how `laySeatItems`, the clamps and the
 * collision tests place them in the first place.
 */
export function canArrangeDecor(
  scene: SceneState,
  id: Id,
  designEditTableId: Id | null,
): boolean {
  const obj = scene.objects[id]
  if (!obj?.parentId || obj.attachment?.kind !== 'surface') return false
  if (isEffectivelyLocked(scene, obj)) return false
  return designEditTable(scene, designEditTableId) === obj.parentId
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

/**
 * Has the user placed anything at all?
 *
 * ⚠ THIS IS NOT `scene.objectOrder.length`, and the difference has now caused
 * three separate bugs, so it lives here rather than being re-derived.
 * `createDefaultScene` (core/model/factory.ts) seeds every parentless BAKED
 * VENUE FIXTURE into `objectOrder` — the bars, the perimeter greenery, the DJ
 * booths — and the resort pack, the only pack that ships, contributes 25 of
 * them. So `objectOrder` reads like "what the user placed" and never is:
 *
 *  · `EmptyCanvasHint` rendered on `objectOrder.length === 0` and therefore
 *    NEVER rendered at all — the app's only onboarding affordance was dead code
 *    in production for as long as the resort pack has existed.
 *  · `hasObjects` armed the clear-all button on a plan with nothing to clear,
 *    which then reported "0 items cleared".
 *  · A verification harness drove `objectOrder[0]`, hit a frozen wall, and
 *    reported three features broken that were in fact refusing correctly.
 *
 * Fixtures are `frozen`, and `frozen` is exactly "belongs to the hall rather
 * than to this event", so that is the right test.
 */
export function hasUserObjects(scene: SceneState): boolean {
  return scene.objectOrder.some((id) => {
    const obj = scene.objects[id]
    return obj !== undefined && !isFrozen(obj)
  })
}

/**
 * How many objects `clearAllObjects` would actually remove.
 *
 * Deliberately a DIFFERENT question from `hasUserObjects`, and the difference is
 * the chairs: this walks every object rather than `objectOrder`, because clearing
 * takes attached children with their parents, and a count that said "3 tables"
 * before removing 39 things would be its own small lie. `hasUserObjects` asks
 * about top-level placement, which is what an empty canvas is about.
 *
 * They share the one rule that matters — a fixture is `frozen` — so the two can
 * disagree about scope but never about what counts as the user's.
 */
export function userObjectCount(scene: SceneState): number {
  let n = 0
  for (const obj of Object.values(scene.objects)) if (!isFrozen(obj)) n++
  return n
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

// --- what the pointer may do (round 4) --------------------------------------

/** The top-level object an id belongs to — itself, or the table it hangs off. */
function rootOf(scene: SceneState, id: Id): Id | null {
  let current: SceneObject | undefined = scene.objects[id]
  if (!current) return null
  while (current.parentId) {
    const parent: SceneObject | undefined = scene.objects[current.parentId]
    if (!parent) break
    current = parent
  }
  return current.id
}

/**
 * Is the pointer allowed to react to this object at all — the one question
 * behind the `move` cursor, the hover outline and the 3D highlight.
 *
 * ⚠ BOTH renderers must ask THIS, not their own three conditions. A hover
 * highlight the plan draws and 3D does not is how the same locked chandelier ends
 * up looking grabbable in one view and inert in the other, and that is the bug
 * class this file exists for (see `canArrangeDecor`).
 *
 * ⚠ Unlike `isDesignEditMuted`, this takes the RAW `designEditTableId` straight
 * off the store. It has `scene` in hand, so it validates for you rather than
 * making every hover handler remember the two-step. Pass `state.designEditTableId`.
 *
 * A CHILD is judged by its top-level ancestor: the chairs and the china of the
 * isolated table stay live while another table's do not, which is what the mode
 * means. `isDesignEditMuted` compares ids directly and is therefore only correct
 * for top-level nodes — its own doc says so, and this is the wrapper that makes
 * the question askable of anything.
 *
 * Locked counts as not hoverable: nothing can be done to a locked object by
 * pointer, and a `move` cursor over one is a promise the next press will break.
 */
export function isHoverable(scene: SceneState, id: Id, designEditTableId: Id | null): boolean {
  const obj = scene.objects[id]
  if (!obj) return false
  if (!isObjectVisible(scene, id)) return false
  if (isEffectivelyLocked(scene, obj)) return false
  const root = rootOf(scene, id)
  return root !== null && !isDesignEditMuted(designEditTable(scene, designEditTableId), root)
}

/**
 * May this object be dragged across the floor?
 *
 * Lifted verbatim from the filter `editor2d/dragController.ts` applies when a
 * drag starts, and it must keep meaning exactly that: an object that EXISTS, is
 * TOP-LEVEL, and is not effectively locked.
 *
 * The `!parentId` clause is the one that surprises people. An attached chair or a
 * table-top setting is not "movable" in this sense — it never travels with a
 * floor drag, it moves only on its own drill-in / design-edit path, and including
 * it here would drag a chair off its seat every time its table was moved.
 * `canRotateObject` deliberately has no such clause; see it.
 */
export function canMoveObject(scene: SceneState, id: Id): boolean {
  const obj = scene.objects[id]
  return !!obj && !obj.parentId && !isEffectivelyLocked(scene, obj)
}

/**
 * May this object be turned?
 *
 * The gate `rotateObjectsBy` applies (`actions.ts` → `editable`): exists and is
 * not effectively locked. NO `!parentId` clause, and that asymmetry with
 * `canMoveObject` is real rather than an oversight — a drilled-in chair can be
 * angled at its own seat, and `rotateObjectsBy` explicitly lets a child through
 * without even a pose probe.
 *
 * It answers "is turning this legal", not "will the result fit": the placement
 * probe runs inside the action, because whether a turned table clears its
 * neighbours depends on the angle, and a handle that vanished mid-drag would be
 * worse than one that refuses at the end with a reason.
 */
export function canRotateObject(scene: SceneState, id: Id): boolean {
  const obj = scene.objects[id]
  return !!obj && !isEffectivelyLocked(scene, obj)
}

/**
 * May design-edit mode be opened on this object?
 *
 * Deliberately the SAME question `designEditTable` asks on every read, delegated
 * rather than restated: a double-click that opened a mode the read-guard then
 * refused to show would look exactly like a dead gesture.
 *
 * Locked is NOT part of it, on purpose. Locking a table pins the TABLE; the decor
 * standing on it is other objects with their own flags, and arranging them is the
 * whole point of the mode.
 */
export function canEditTable(scene: SceneState, id: Id): boolean {
  return designEditTable(scene, id) !== null
}

/**
 * The one table the user has selected, or null — what a rotation ring, a seating
 * section or a table-design panel keys off.
 *
 * Its four clauses coincide with `designEditTable`'s today and are still written
 * out here, because they are justified differently: this is about what a SELECTION
 * addresses, that is about what a MODE may stay open on. Kept separate so a change
 * to one is a decision rather than a side effect.
 *
 *  - exactly one id, since "the table" has no meaning for a multi-selection;
 *  - it still exists, since a selection outlives a delete until `pruneSelection`;
 *  - it is top-level, since an attached chair carries `seating` on some entries;
 *  - it is visible, since a ring drawn round a hidden table is a control floating
 *    over nothing.
 */
export function selectedTable(scene: SceneState, selection: Id[]): Id | null {
  if (selection.length !== 1) return null
  const id = selection[0]
  const obj = scene.objects[id]
  if (!obj || obj.parentId) return null
  if (!isTable(obj) || !isObjectVisible(scene, id)) return null
  return id
}

/** The limits the seating fields must not let the user past. */
export interface SeatBounds {
  /** fewest chairs the catalog entry allows */
  min: number
  /** most that the entry AND the geometry allow, at the current gap */
  max: number
  /** largest whole-cm gap that still seats the entry's default count */
  gapMax: number
}

/**
 * Both seating limits for a table, or null if it is not one.
 *
 * Moved here out of `ui/InspectorPanel.tsx`, where it was computed inline: the
 * same two numbers are what a 3D seating control and any "add chairs" affordance
 * must clamp to, and a second copy of `Math.min(cap.max, maxSeatsForEntry(...))`
 * is a second place for the two to disagree.
 *
 * `gapMax` is not decoration. Capacity is a STEP function of gap with very narrow
 * steps — the 160 square seats 12 at gap 8 and 8 at gap 9 — so a free 0–60 field
 * deletes four chairs on one nudge (`core/layout/seatLayout.ts` carries the
 * measurements).
 *
 * It is stricter than the inline version in one way: the chair's catalog id is
 * checked before it is looked up. `getCatalogEntry` THROWS on an unknown id, and
 * a scene saved with a chair model that has since been retired would take the
 * whole inspector down rather than hide one section.
 */
export function seatBounds(scene: SceneState, id: Id): SeatBounds | null {
  const obj = scene.objects[id]
  if (!obj?.seating || !hasCatalogEntry(obj.catalogId)) return null
  const entry = getCatalogEntry(obj.catalogId)
  const cap = entry.seating
  if (!cap || !hasCatalogEntry(obj.seating.chairCatalogId)) return null
  const chair = getCatalogEntry(obj.seating.chairCatalogId).defaultSize
  return {
    min: cap.min,
    max: Math.min(cap.max, maxSeatsForEntry(entry, obj.size, obj.seating, chair)),
    gapMax: maxGapForSeats(entry, obj.size, obj.seating, chair, cap.defaultCount),
  }
}

/**
 * Which menu a right-click earned. Three of them are objects and differ only in
 * what may be done to the thing under the pointer; 'canvas' is the empty-floor
 * menu, whose entries (paste, select all, zoom) are questions for the clipboard
 * and the viewport rather than for the scene.
 */
export type MenuTargetKind = 'canvas' | 'object' | 'surfaceChild' | 'attachedChild'

export interface MenuCapabilities {
  kind: MenuTargetKind
  /** the ids the entries act on — the selection for an object, the one child otherwise */
  ids: Id[]
  canDuplicate: boolean
  canCopy: boolean
  canCut: boolean
  canRotate: boolean
  canReplace: boolean
  canReorder: boolean
  canLock: boolean
  canDelete: boolean
  /** the lock entry reads "unlock" when any acted-on object carries `flags.locked` */
  anyLocked: boolean
}

/**
 * What a context menu on `targetId` may legally offer.
 *
 * Modelled on the menu `editor2d/Stage2D.tsx` builds today, with one difference
 * that is the reason it moved: today only `replace` is disabled, and every other
 * entry is shown and then silently dropped inside the action — `removeObjects`
 * skips a locked object, `duplicateObjects` skips a child, `setLocked` skips a
 * frozen one. "Delete" that does nothing is the exact failure round 3 was
 * criticised for. These booleans state the rules the actions already enforce, so
 * a menu can grey the entry instead of lying about it.
 *
 * `ids` is resolved rather than assumed. Stage2D selects the target before it
 * opens the menu, so the two normally agree — but making this a pure function of
 * its arguments means a caller that has not selected yet gets the target's own
 * menu instead of the previous selection's.
 *
 * Each flag names the action that owns it:
 *   canDuplicate/canReorder  top-level only (`duplicateObjects` skips children,
 *                            `reorder` only touches `objectOrder`)
 *   canCopy                  anything at all; copying mutates nothing
 *   canCut                   copy + delete, so it needs both
 *   canRotate                `canRotateObject` (children included)
 *   canReplace               exactly one selected, and it unlocked — byte-for-byte
 *                            the condition Stage2D disables the entry on today
 *   canLock                  `setLocked` guards on `isFrozen`, not on locked
 *   canDelete                `removeObjects` guards on `isEffectivelyLocked`
 */
export function menuCapabilities(
  scene: SceneState,
  selection: Id[],
  targetId: Id | null,
): MenuCapabilities {
  const target = targetId ? scene.objects[targetId] : undefined
  if (!targetId || !target) return emptyCapabilities('canvas')

  if (target.parentId) {
    const kind: MenuTargetKind =
      target.attachment?.kind === 'surface' ? 'surfaceChild' : 'attachedChild'
    return {
      ...emptyCapabilities(kind),
      ids: [targetId],
      // a table-top item lives on its table: it is deleted, never detached, and a
      // drilled-in chair is deleted as "one seat less" — either way, one entry
      canDelete: !isEffectivelyLocked(scene, target),
      anyLocked: target.flags.locked,
    }
  }

  const ids = (selection.includes(targetId) ? selection : [targetId]).filter(
    (id) => !!scene.objects[id],
  )
  const topLevel = ids.filter((id) => !scene.objects[id].parentId)
  const removable = ids.some((id) => !isEffectivelyLocked(scene, scene.objects[id]))
  return {
    kind: 'object',
    ids,
    canDuplicate: topLevel.length > 0,
    canCopy: ids.length > 0,
    canCut: ids.length > 0 && removable,
    canRotate: ids.some((id) => canRotateObject(scene, id)),
    canReplace: ids.length === 1 && !isEffectivelyLocked(scene, target),
    canReorder: topLevel.length > 0,
    canLock: ids.some((id) => !isFrozen(scene.objects[id])),
    canDelete: removable,
    anyLocked: ids.some((id) => scene.objects[id].flags.locked),
  }
}

function emptyCapabilities(kind: MenuTargetKind): MenuCapabilities {
  return {
    kind,
    ids: [],
    canDuplicate: false,
    canCopy: false,
    canCut: false,
    canRotate: false,
    canReplace: false,
    canReorder: false,
    canLock: false,
    canDelete: false,
    anyLocked: false,
  }
}

// --- what a MULTI-selection may be edited with (round 5) ---------------------

/** One restyleable slot across a selection, and exactly who wears it. */
export interface SelectionSlot {
  slot: string
  /** key into `strings.catalog.slots`; absent when the entry names no label */
  labelKey?: string
  /** any member offers the fabric picker beside the palette */
  texture: boolean
  /** any member opens the free colour picker (the three napkins) */
  allowCustomColor: boolean
  /** ⚠ THE IDS THE WRITE WILL TOUCH — editable members only, so the count cannot lie */
  ids: Id[]
  /** the colour they all wear, or null when they disagree */
  sharedColor: string | null
  /** the texture they all wear; `null` is also the legitimate value "no texture" */
  sharedTextureId: string | null
  /** ⚠ the flag that tells the two `null`s apart — see the note on the interface */
  mixedTexture: boolean
}

/**
 * Everything the multi-selection inspector needs, in ONE pure pass over the scene.
 *
 * ⚠ THE ASYMMETRY BETWEEN `sharedColor` AND `mixedTexture` IS LOAD-BEARING.
 * `slotColor` always returns a string (the override, else the catalogue default),
 * so a `null` there is unambiguous: "they disagree". `slotTextureId` returns
 * `null` as a VALUE — "no texture", which the user can choose and which is not the
 * same as "not chosen" (see the three-state note on `AppearanceOverrides`). One
 * flag for both would report a whole selection of bare cloths as a conflict, and a
 * genuine conflict as "no texture". Hence the extra boolean.
 *
 * ⚠ HOW TO CONSUME IT — not negotiable:
 *
 *     const scene = useEditorStore((s) => s.scene)
 *     const selection = useEditorStore((s) => s.selection)
 *     const edit = useMemo(() => selectionEditing(scene, selection), [scene, selection])
 *
 * NEVER `useEditorStore((s) => selectionEditing(s.scene, s.selection))`. This
 * builds fresh arrays on every call; zustand v5 reads through
 * `useSyncExternalStore`, which compares snapshots with `Object.is`, so such a
 * selector never settles — React re-renders, re-selects, and bails out with a
 * WHITE SCREEN whose message names nothing in this file. That already shipped once
 * here, on the `⋯` menu (`viewer3d/SelectionBar3D.tsx`). `scene` and `selection`
 * are Immer-stable, so the memo recomputes only when one genuinely changes.
 *
 * It is a SIBLING of `menuCapabilities`, deliberately not an extension of it: that
 * one is keyed on a right-click `targetId` and answers menu-verb questions
 * (copy/cut/reorder), while this one has no target at all and answers FIELD
 * questions (what is the shared angle, which slots do these share). The primitives
 * are shared — `canRotateObject`, `isEffectivelyLocked`, `isFrozen` — so the two
 * can differ in scope but never in the rules.
 */
export interface SelectionEditing {
  /** the selection minus ids whose object is already gone (a delete outlives it a render) */
  ids: Id[]
  /** not frozen, not locked, not on a locked layer — what every write filters to anyway */
  editableIds: Id[]
  /** how many of `ids` a write will silently skip */
  lockedCount: number
  /** those a per-object unlock button can actually open (frozen cannot be opened) */
  unlockableIds: Id[]
  /** top-level floor tables in the selection — the scope of every dressing control */
  tableIds: Id[]
  /** …of which these are not locked: the ones an apply really lands on */
  editableTableIds: Id[]
  /** the angle they all stand at (whole degrees), or null when they disagree */
  sharedRotation: number | null
  /** the chair model every selected table wears, or null when they disagree */
  sharedChairCatalogId: string | null
  slots: SelectionSlot[]
  canRotate: boolean
  canMirror: boolean
  canDuplicate: boolean
  canLock: boolean
  canDelete: boolean
  anyLocked: boolean
}

/** The one value they all share, or null. An empty list shares nothing. */
function shared<T>(values: T[]): T | null {
  if (!values.length) return null
  const first = values[0]
  return values.every((v) => v === first) ? first : null
}

export function selectionEditing(scene: SceneState, selection: Id[]): SelectionEditing {
  const ids = selection.filter((id) => !!scene.objects[id])
  const objects = ids.map((id) => scene.objects[id])
  const editable = objects.filter((o) => !isEffectivelyLocked(scene, o))
  const editableIds = editable.map((o) => o.id)
  const topLevel = objects.filter((o) => !o.parentId)
  const tableIds = topLevel
    .filter(
      (o) => !!o.seating && hasCatalogEntry(o.catalogId) && isFloorTable(getCatalogEntry(o.catalogId)),
    )
    .map((o) => o.id)

  // Over the ROTATABLE members only, not the whole selection: a locked table at 0°
  // must not turn two free ones at 45° into a "conflict" for a field that was never
  // going to touch it. Whole degrees, because a dragged angle is a float and
  // 44.9999 vs 45.0001 is not a disagreement anyone means.
  const rotatable = ids.filter((id) => canRotateObject(scene, id))
  const sharedRotation = shared(rotatable.map((id) => Math.round(scene.objects[id].transform.rotation)))

  return {
    ids,
    editableIds,
    lockedCount: ids.length - editableIds.length,
    unlockableIds: objects.filter((o) => o.flags.locked && !isFrozen(o)).map((o) => o.id),
    tableIds,
    editableTableIds: tableIds.filter((id) => !isEffectivelyLocked(scene, scene.objects[id])),
    sharedRotation,
    sharedChairCatalogId: shared(
      tableIds.map((id) => scene.objects[id].seating?.chairCatalogId ?? ''),
    ),
    slots: selectionSlots(editable),
    canRotate: rotatable.length > 0,
    // `mirrorObjects` filters to editable TOP-LEVEL — a mirrored place setting on
    // an unmirrored table is not a thing the user can mean
    canMirror: editable.some((o) => !o.parentId),
    // `duplicateObjects`' own rule, lock test included — i.e. absent. A locked
    // source is copyable; the copy is a new, unlocked object.
    canDuplicate: topLevel.length > 0,
    canLock: objects.some((o) => !isFrozen(o)),
    canDelete: editableIds.length > 0,
    anyLocked: objects.some((o) => o.flags.locked),
  }
}

/**
 * The UNION of the restyleable slots, in first-seen catalogue order, each carrying
 * the subset that has it.
 *
 * Union and not intersection, and that is the whole point: on 6 tables + 3 chairs
 * + a plant the intersection is empty, which IS the complaint this round answers.
 * Each row states its own count instead, so "מפת שולחן (6)" says in the label
 * exactly what the click will do — and `setAppearance` re-checks `isEditableSlot`
 * per object anyway, so a row can never write somewhere it does not belong.
 */
function selectionSlots(objects: SceneObject[]): SelectionSlot[] {
  const rows: SelectionSlot[] = []
  const byName = new Map<string, { row: SelectionSlot; colors: string[]; textures: (string | null)[] }>()
  for (const obj of objects) {
    if (!hasCatalogEntry(obj.catalogId)) continue
    const entry = getCatalogEntry(obj.catalogId)
    for (const editable of editableSlotsOf(entry)) {
      const def = entry.materialSlots.find((s) => s.name === editable.slot)
      let cell = byName.get(editable.slot)
      if (!cell) {
        const row: SelectionSlot = {
          slot: editable.slot,
          labelKey: def?.labelKey,
          texture: false,
          allowCustomColor: false,
          ids: [],
          sharedColor: null,
          sharedTextureId: null,
          mixedTexture: false,
        }
        rows.push(row)
        cell = { row, colors: [], textures: [] }
        byName.set(editable.slot, cell)
      }
      // ANY member offering the control is enough to show it: the write is guarded
      // per object, and hiding the picker because one chair in the selection has no
      // weave would take it away from the six tables that do
      if (editable.texture) cell.row.texture = true
      if (def?.allowCustomColor) cell.row.allowCustomColor = true
      cell.row.ids.push(obj.id)
      cell.colors.push(slotColor(entry, obj.appearance, editable.slot))
      cell.textures.push(slotTextureId(entry, obj.appearance, editable.slot))
    }
  }
  for (const { row, colors, textures } of byName.values()) {
    row.sharedColor = shared(colors)
    // ⚠ NOT `shared(textures)`: that returns null both for "they all chose none"
    // and for "they disagree", which are the two states this row exists to tell
    // apart. Agreement is asked directly, and the answer may itself be null.
    const agreed = textures.every((t) => t === textures[0])
    row.mixedTexture = !agreed
    row.sharedTextureId = agreed ? textures[0] : null
  }
  return rows
}
