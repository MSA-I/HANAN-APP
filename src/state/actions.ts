/**
 * Every mutation of the editor state goes through these actions — the single
 * write path is what keeps undo, seat reconciliation and 2D/3D sync coherent.
 */
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import { isEditableSlot, isFloorTable, type CatalogEntry, type Category } from '../core/catalog/types'
import { isTextureId } from '../core/catalog/textures'
import { createObject, createProject, newId, type NewProjectOptions } from '../core/model/factory'
import { reconcileSeats } from '../core/model/seatingReconciler'
import type {
  Id,
  LightingSettings,
  Project,
  SceneObject,
  SceneSettings,
  SceneState,
  SeatingConfig,
  Size3D,
  Transform2D,
  Vec2,
} from '../core/model/types'
import { normalizeDeg, relativeTransform, rotateVec } from '../core/space'
import { holeRadius, outlineAABB, type AABB } from '../core/layout/bounds'
import {
  allowedOnDeck,
  checkPlacement,
  clearanceOf,
  slideToLegal,
  type PlacementCandidate,
  type Violation,
} from '../core/layout/collision'
import {
  CEILING_INSET,
  DEFAULT_AISLE,
  MAX_CEILING,
  MAX_FILL,
  ceilingAreas,
  fillHallSlots,
  rectRing,
  tableCellSize,
} from '../core/layout/fillHall'
import {
  beamGrid,
  clampHang,
  rollHangTiers,
  snapToBeam,
  tierElevation,
  type HangTier,
} from '../core/layout/beams'
import { isZoneInside } from '../core/layout/zoneOccupancy'
import { seatItemTransforms } from '../core/layout/seatItemLayout'
import { seatItemSeatsForEntry } from '../core/layout/seatLayout'
import { serpentineCentre, serpentineSeats } from '../core/layout/serpentine'
import { getHallLayout } from '../core/hallLayouts'
import {
  createTableDesignLayout,
  instantiateSavedLayout,
  missingCatalogIds,
  sameVenueSignature,
  venueSignature,
  LAYOUT_TAG,
  type SavedLayout,
} from '../core/savedLayouts'
import {
  getHallDesign,
  getTableDesign,
  getTablePreset,
  presetSeating,
  type TableDesign,
} from '../core/presets'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { overlay } from '../editor2d/overlayStore'
import {
  childrenOf,
  isEffectivelyLocked,
  isFrozen,
  isObjectVisible,
  lightingOf,
  objectAABB as objectAABBOf,
  subtreeAABB,
  surfaceChildren,
} from './selectors'
import { notify } from './notice'
import { strings } from '../ui/strings'
import { temporalStore, useEditorStore, type ActiveZone, type EditorState, type ViewMode } from './store'

const set = useEditorStore.setState
const get = useEditorStore.getState

/**
 * Why the last mutation refused to do what it was asked. Written by the rule
 * gates below (never by a component) and flushed to the overlay store by
 * `mutateScene`, so a blocked drag explains itself in the status bar and the
 * message clears the moment anything else succeeds.
 *
 * Set BEFORE the producer opens (that is where the gates run) or inside it;
 * `mutateScene` publishes whatever is pending and clears it, so an action that
 * refuses nothing publishes null and wipes the previous message.
 */
let refusal: Violation | null = null

function mutateScene(fn: (scene: SceneState, state: EditorState) => void): void {
  set((state) => {
    fn(state.scene, state)
    state.dirty = true
  })
  overlay.setViolation(refusal)
  refusal = null
}

/** A gesture that changed nothing still owes the user the reason. No scene write,
 *  so a refused rotation neither dirties the project nor lands in undo. */
function publishRefusal(): void {
  overlay.setViolation(refusal)
  refusal = null
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

/** ids expanded so that locked objects (frozen, own flag, or locked layer) are filtered out */
function editable(scene: SceneState, ids: Id[]): SceneObject[] {
  return ids
    .map((id) => scene.objects[id])
    .filter((o): o is SceneObject => !!o && !isEffectivelyLocked(scene, o))
}

// ---------------------------------------------------------------------------
// placement rules — the gate every NEW gesture passes through
// ---------------------------------------------------------------------------

/** The legality question for an existing object, optionally at a hypothetical pose. */
function candidateFor(
  obj: SceneObject,
  at?: { transform?: Transform2D; size?: Size3D },
  group?: Id[],
): PlacementCandidate {
  // The two callers of `checkPlacement` speak different frames: the ghost of a new
  // drop hands over a WORLD point, an existing child's stored transform is already
  // parent-local. This is the side that declares which one it is holding.
  //
  // `inHole` is read from the attachment and never re-derived from the point — it
  // was settled once at drop (model/types.ts:40-56), and working it out again
  // mid-drag is what would drop a piece 75cm between two frames.
  const child = !!obj.parentId
  const inHole = obj.attachment?.kind === 'surface' && obj.attachment.inHole === true
  return {
    catalogId: obj.catalogId,
    transform: at?.transform ?? obj.transform,
    size: at?.size ?? obj.size,
    excludeId: group ?? obj.id,
    subtreeOf: obj.id,
    parentId: obj.parentId ?? undefined,
    parentLocal: child ? true : undefined,
    inHole: child ? inHole : undefined,
  }
}

/**
 * Do the rules apply to this object at all?
 *
 * A table-top child IS judged, which it was not before PLAN-06. It answers to one
 * rule and only one — it may not stand in another item on the same table — and
 * `clampToSurface` keeps it on the top as it always did; the venue rules never
 * reach into a table top (collision.ts `check`). The blanket exemption that used
 * to sit on the first line here is what let a second centrepiece land inside the
 * first: every gate below it was reachable only by a top-level object.
 *
 * Two exemptions, both deliberate:
 *
 *  - A fixed station (`zoneKind`: bar, DJ booth, chuppah) is not placed by the
 *    user at all — `clampToVenue` snaps it into its home zone from wherever it
 *    was let go. Gating it would refuse moves that were going to be overridden.
 *  - An object that is ALREADY illegal where it stands. Enforcement is not
 *    retroactive (plan decision, source doc §9): a project saved before these
 *    rules, or one a legacy path pushed into a zone, must stay editable. Gating
 *    it would freeze it in place forever, since every candidate pose inherits
 *    the same violation. This now covers CHILDREN too, and deliberately so: a
 *    decoration already overlapping its neighbour — laid by an old design, or by
 *    `addObjectToSurface`, which does not gate — stays free to be dragged,
 *    turned and resized, including apart. Refusing is the one answer that could
 *    never undo the overlap.
 */
function ruled(scene: SceneState, obj: SceneObject, ignoreIds?: Id[]): boolean {
  if (getCatalogEntry(obj.catalogId).zoneKind) return false
  // `ignoreIds` is what keeps Alt+drag from disarming its own gate: the copy it
  // parks in exact overlap with the original would otherwise make this `false` on
  // every frame of the drag, and enforcement would be off for the whole gesture.
  const group = ignoreIds?.length ? [obj.id, ...ignoreIds] : undefined
  return checkPlacement(scene, candidateFor(obj, undefined, group)).length === 0
}

function shiftedBy(t: Transform2D, delta: Vec2, factor = 1): Transform2D {
  return { ...t, position: { x: t.position.x + delta.x * factor, y: t.position.y + delta.y * factor } }
}

/**
 * The largest fraction of `delta` the whole selection may travel. A group moves
 * rigidly — bisecting one scalar keeps it that way, and stopping AT the contact
 * point is what makes a blocked drag read as sliding into place rather than
 * freezing at the start of the gesture.
 */
function allowedDelta(
  scene: SceneState,
  objs: SceneObject[],
  delta: Vec2,
  ignoreIds?: Id[],
): Vec2 {
  const gated = objs.filter((o) => ruled(scene, o, ignoreIds))
  if (!gated.length || (!delta.x && !delta.y)) return delta
  // the Alt+drag copies join the exclusion set the selection already forms: they
  // are the gesture's own output, not an obstacle it has to steer around
  const ids = [...gated.map((o) => o.id), ...(ignoreIds ?? [])]
  // Each object is probed in the frame its own transform lives in. `delta` is the
  // world vector the pointer asked for, and a child's position is parent-local, so
  // for a child it has to be turned into the parent's frame first — the same
  // conversion `moveObjectsBy` makes when it APPLIES the move. Done once per
  // object rather than inside the bisection, which runs it twelve more times.
  const moves = gated.map((o) => {
    const parent = o.parentId ? scene.objects[o.parentId] : undefined
    return { obj: o, delta: parent ? rotateVec(delta, -parent.transform.rotation) : delta }
  })
  const violationsAt = (factor: number): Violation[] =>
    moves.flatMap(({ obj, delta: local }) =>
      checkPlacement(scene, candidateFor(obj, { transform: shiftedBy(obj.transform, local, factor) }, ids)),
    )

  const blocking = violationsAt(1)
  if (!blocking.length) return delta
  refusal = blocking[0]
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (violationsAt(mid).length) hi = mid
    else lo = mid
  }
  // one scalar for the whole selection, and the answer stays in WORLD units: the
  // caller converts per object exactly as it applies the move
  return { x: delta.x * lo, y: delta.y * lo }
}

/**
 * The first whole multiple of `dir` at which EVERY candidate is legal, or `null`.
 *
 * ⚠ ONE SCALAR FOR THE WHOLE SET, exactly as `allowedDelta` above uses one: a copy
 * operation on a selection has to land the copies in the arrangement they were
 * copied in. Solving per object would pull a paired set apart the moment one of
 * them found floor a step sooner. A rigid translation preserves every gap inside
 * the set, so if the originals were mutually legal the copies are too, at any k.
 *
 * Deliberately PERMISSIVE: the callers must land even when this returns `null`
 * (§4.3), because a duplicate that silently fails is worse than one that lands
 * tight. What the search prevents is not "a copy in a poor spot" but "an overlap
 * that switches `ruled()` off for BOTH pieces" — see the note on `ruled`.
 */
function firstLegalStep(
  scene: SceneState,
  moves: Array<{ candidate: PlacementCandidate; from: Vec2 }>,
  dir: Vec2,
  steps = 8,
): number | null {
  if (!moves.length || (!dir.x && !dir.y)) return null
  for (let k = 1; k <= steps; k++) {
    const clear = moves.every(
      ({ candidate, from }) =>
        !checkPlacement(scene, {
          ...candidate,
          transform: {
            ...candidate.transform,
            position: { x: from.x + dir.x * k, y: from.y + dir.y * k },
          },
        }).length,
    )
    if (clear) return k
  }
  return null
}

/**
 * How many multiples of `offset` a copy may walk before it gives up.
 *
 * NOT a constant, and this was measured rather than guessed. The walk has to be
 * able to clear the object itself, and the catalog spans a 45 cm chair and a
 * 477 × 502 cm serpentine. Eight steps of the default +50/+50 is 566 cm of travel,
 * while the serpentine's own 692 cm box diagonal plus its 170 cm aisle needs 862 —
 * so a fixed eight left Ctrl+D on the very table this plan is about still landing
 * inside itself, with the gate still switched off for both pieces. It needs 13.
 *
 * The floor of 8 keeps small items walking a sensible minimum, and the ceiling
 * bounds the work: this runs once per copy gesture, never on a drag frame.
 */
function stepsToClear(scene: SceneState, srcs: SceneObject[], offset: Vec2): number {
  const len = Math.hypot(offset.x, offset.y)
  if (!len) return 0
  let reach = 0
  for (const src of srcs) {
    const box = subtreeAABB(scene, src.id)
    const entry = getCatalogEntry(src.catalogId)
    const aisle = isFloorTable(entry)
      ? clearanceOf(entry, entry.footprint(src.size).outline)
      : 0
    const diagonal = box ? Math.hypot(box.maxX - box.minX, box.maxY - box.minY) : 0
    reach = Math.max(reach, diagonal + aisle)
  }
  return Math.min(60, Math.max(8, Math.ceil(reach / len)))
}

/** The first legal point along `dir` starting from `from`. `null` = none found. */
function firstLegalAlong(
  scene: SceneState,
  candidate: PlacementCandidate,
  from: Vec2,
  dir: Vec2,
  steps = 8,
): Vec2 | null {
  const k = firstLegalStep(scene, [{ candidate, from }], dir, steps)
  return k === null ? null : { x: from.x + dir.x * k, y: from.y + dir.y * k }
}

/** Refuse a pose change (rotation, resize) outright — there is nothing to slide along. */
function poseAllowed(scene: SceneState, obj: SceneObject, at: { transform?: Transform2D; size?: Size3D }): boolean {
  if (!ruled(scene, obj)) return true
  const blocking = checkPlacement(scene, candidateFor(obj, at))
  if (!blocking.length) return true
  refusal = blocking[0]
  return false
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

/** Does a box touch a zone rectangle at all? */
function overlapsZone(box: AABB, z: RestrictedZone): boolean {
  return box.minX < z.x + z.width && box.maxX > z.x && box.minY < z.y + z.depth && box.maxY > z.y
}

/** Shift to keep a box INSIDE a zone rectangle (a fixed station in its home zone). */
function zoneShift(box: AABB, z: RestrictedZone): Vec2 {
  let x = 0
  let y = 0
  if (box.maxX - box.minX > z.width) x = z.x + z.width / 2 - (box.minX + box.maxX) / 2
  else if (box.minX < z.x) x = z.x - box.minX
  else if (box.maxX > z.x + z.width) x = z.x + z.width - box.maxX
  if (box.maxY - box.minY > z.depth) y = z.y + z.depth / 2 - (box.minY + box.maxY) / 2
  else if (box.minY < z.y) y = z.y - box.minY
  else if (box.maxY > z.y + z.depth) y = z.y + z.depth - box.maxY
  return { x, y }
}

/**
 * Bounds enforcement. Clamps each touched TOP-LEVEL object into its home zone
 * (fixed stations) or onto the reception deck (whitelist), and — in `legacy`
 * mode only — shoves it back onto the venue floor and out of every no-go zone.
 * Attached chairs follow their clamped table, so we skip them here. Objects
 * larger than the venue align to the near edge.
 *
 * ## The two modes
 *
 * `strict` (default) does NOT push. Since the placement gate above refuses an
 * illegal move before it happens, a push here could only ever fire on a pose the
 * user did not ask for — silently relocating furniture behind a legal-looking
 * drag, which is the behaviour source doc §57 complains about.
 *
 * `legacy` keeps the original shove, and four kinds of caller need it:
 *
 * | route | why it must still push |
 * |---|---|
 * | `addObject` | the drop point is pre-validated by the ghost; the reception deck still has to eject what does not belong on it, and the kabalatPanim rule is a push by definition |
 * | `applyHallLayout` / `applySavedLayout` | the authored layout wins over the rules; refusing would silently drop tables from a saved plan |
 * | `fillHallWithTables` | the filler already solved occupancy; re-judging it here would reject its own valid slots |
 * | `duplicateObjects` / `pasteSubtrees` / align / distribute | a group operation is nudged as a unit, never rejected item by item |
 *
 * A migration needs no entry: `migrations/index.ts` deliberately does not clamp,
 * and an old project is only ever re-clamped by the user's first real edit.
 */
type ClampMode = 'strict' | 'legacy'

function clampToVenue(scene: SceneState, ids: Iterable<Id>, mode: ClampMode = 'strict'): void {
  const { width, depth } = scene.venue.size
  const pack = getVenuePack(scene.venue.venuePackId)
  const zones = pack?.restricted ?? []
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
    // A comparison cannot REJECT a non-finite box: `box.minX < 0` and
    // `box.maxX > width` are both false for NaN, so it neither trips a rule nor is
    // turned away by one. Every branch below happens to compare before it computes,
    // so as things stand a broken box yields no shift rather than a NaN one — the
    // leak is closed by luck. Any shift computed from it WOULD be written straight
    // into `transform.position`, where nothing can recover it. Asking whether the
    // numbers are finite is what closes it on purpose.
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) continue
    let d = mode === 'legacy' ? floorShift(box, width, depth) : { x: 0, y: 0 }
    if (d.x || d.y) box = shift(obj, box, d)

    // The reception deck is an INVERTED zone: a whitelisted item dropped on it is
    // clamped IN, everything else is pushed out like any other no-go rectangle. It
    // also wins over the home zone — a chuppah dropped up there is meant to stay
    // there, and its `zoneKind` would otherwise teleport it back down to the hall's
    // ceremony rectangle (source doc §43).
    //
    // The whitelist is `allowedOnDeck`, and there is exactly one of it. This file
    // used to keep a second copy, with a comment asking for the two to be kept in
    // step by hand — and they drifted, which is round-2 correction §27 in one
    // sentence: collision.ts admitted a guest table onto the deck while the clamp
    // here went on shoving it off. One list is what stops "may it be here" and
    // "does it stay here" from disagreeing again.
    // fixed station: snap into the nearest matching home zone and stop there
    const zoneKind = getCatalogEntry(obj.catalogId).zoneKind
    const home = zoneKind ? zones.filter((z) => z.kind === zoneKind) : []

    const reception = zones.find((z) => z.kind === 'kabalatPanim')
    // ⚠ …except for a station whose family has a pad ON the deck. The rule above
    // was written when the deck had no pads of its own: keeping a chuppah up here
    // then meant overriding its `zoneKind`, because the only ceremony rectangle in
    // existence was downstairs. The user has since drawn one on the deck, and the
    // home branch below now snaps to the NEAREST member of the family — which for
    // anything standing up here is the deck's own pad. Letting the deck clamp win
    // instead only guarantees the piece stays somewhere on the deck, which is how
    // a chuppah came to be placeable anywhere across it rather than on the pad
    // that was drawn for it.
    const stationOnDeck = !!reception && home.some((z) => isZoneInside(z, reception))
    if (
      reception &&
      !stationOnDeck &&
      overlapsZone(box, reception) &&
      allowedOnDeck(getCatalogEntry(obj.catalogId))
    ) {
      d = zoneShift(box, reception)
      if (d.x || d.y) shift(obj, box, d)
      continue
    }
    if (home.length) {
      const center = (z: RestrictedZone) => ({ x: z.x + z.width / 2, y: z.y + z.depth / 2 })
      const nearestHome = (candidate: AABB) => {
        const bc = { x: (candidate.minX + candidate.maxX) / 2, y: (candidate.minY + candidate.maxY) / 2 }
        return home.reduce((a, b) => {
          const da = Math.hypot(center(a).x - bc.x, center(a).y - bc.y)
          const db = Math.hypot(center(b).x - bc.x, center(b).y - bc.y)
          return db < da ? b : a
        })
      }
      let nearest = nearestHome(box)

      // Some zone-bound structures fit at cardinal angles but not diagonally.
      // A translation cannot put an over-wide AABB inside its home zone, so snap
      // only those impossible rotations to the nearest quarter turn and measure
      // again. Smaller stations keep their free rotation.
      //
      // handoff/04-to-03.md §3 asks whether this should refuse instead of
      // rewriting the angle now that the clamp blocks elsewhere. It stays a
      // rewrite: a fixed station is exempt from the placement gate entirely
      // (see `ruled`), and which chuppot are over-wide depends on CATALOG_SCALE,
      // still open as gate 4b in BLOCKED-01-A3. chuppah.test.ts locks the
      // current behaviour; flipping it is PLAN-01's gate to close, not ours.
      if (box.maxX - box.minX > nearest.width || box.maxY - box.minY > nearest.depth) {
        obj.transform.rotation = Math.round(obj.transform.rotation / 90) * 90
        box = subtreeAABB(scene, id) ?? box
        // a station is clamped in both modes, so it is re-seated in both too
        d = floorShift(box, width, depth)
        if (d.x || d.y) box = shift(obj, box, d)
        nearest = nearestHome(box)
      }
      d = zoneShift(box, nearest)
      if (d.x || d.y) shift(obj, box, d)
      continue
    }

    // Restricted zones are FLOOR no-go areas — their own contract says furniture
    // is pushed out. A ceiling fixture is not on the floor, and pushing it meant
    // nothing could ever hang over the dance floor or the bar. Instead it is
    // pinned to the truss lattice (source doc §12), which is what makes 2D drag,
    // arrow keys, paste and align agree with the 3D drag and the initial drop.
    if (getCatalogEntry(obj.catalogId).placement === 'ceiling') {
      const beamed = snapToBeam(obj.transform.position, beamGrid(pack, scene.venue.size))
      obj.transform.position.x = beamed.x
      obj.transform.position.y = beamed.y
      continue
    }

    if (mode === 'strict') continue
    // The other half of `ignoresZones`, and it has to be here rather than higher up:
    // the floor re-seat at the top of this pass must still run, so a decoration
    // dropped half outside the building is pulled back in, and only the zone PUSH is
    // skipped. Without this line the entry would be judged legal in the pool by
    // `checkPlacement` and shoved out of it by `addObject` a moment later — a green
    // ghost and then an object somewhere else, the exact fault §57 is about.
    if (getCatalogEntry(obj.catalogId).ignoresZones) continue
    // The other half of the rule collision.ts applies when it JUDGES a drop: a zone
    // an entry may stand ONLY in must not be the zone that ejects it. Vegetation 1
    // is allowed nowhere but the pool surround, so without this `addObject` would
    // shove it out of the one place it is legal the instant it landed — a green
    // ghost, then an object somewhere else. Every OTHER zone still pushes it, the
    // pool included: only the zone the entry names stops being a no-go for it.
    const allowed = getCatalogEntry(obj.catalogId).allowedZones
    for (const z of zones) {
      if (z.kind && allowed?.some((rule) => rule.kind === z.kind)) continue
      const p = zonePush(box, z, width, depth)
      if (!p.x && !p.y) continue
      box = shift(obj, box, p)
      d = floorShift(box, width, depth) // re-seat on the floor if the push crossed an edge
      if (d.x || d.y) box = shift(obj, box, d)
    }
  }
}

/**
 * Height at which another item may STAND on an item, when that is NOT the item's
 * full height — keyed by catalog id, in catalogue centimetres at the entry's
 * `defaultSize`. Absent means "the full height", which is right for everything
 * flat: a table top, the ring table's cloth, a charger laid on its own.
 *
 * `decor.place-setting` is catalogued at 15 cm and that 15 cm is its WINE GLASS,
 * the tallest geometry in the model. A napkin is laid on the CHARGER, so laying
 * it at 15 cm is exactly the "napkins float in the air" report (source doc §12,
 * §45b) — the napkin was sitting at glass-rim height.
 *
 * MEASURED, not guessed. public/props/decor-place-setting.glb arrives from
 * glb-prep as ONE merged mesh, so the plate cannot be picked out by name; it was
 * isolated as the cover's only surface of revolution (the rim ring fits an axis
 * at x=1.5, z=-2.75) and read there:
 *
 *   plate top      2.2908 cm in FILE units — a FLAT annulus, 457 vertices within
 *                  0.02 cm of it at radius 12.6-14.4 cm, so it is a real rim and
 *                  not a spike
 *   nothing else   reaches above 2.291 cm anywhere inside r = 15 cm; the wine
 *                  glass (18.73) only starts at r = 15
 *
 * File units become catalogue centimetres through the loader's PER-AXIS fit
 * (viewer3d/propModel.ts:71-76), which scales the file by `size / modelSize`:
 *
 *   2.2908 * (defaultSize.height / modelSize.height) = 2.2908 * 15 / 18.73 = 1.8346
 *
 * ⚠ That makes the number below a function of the entry's declared height. A
 * RESIZED instance is handled (`stackHeight` scales by size/defaultSize), but if
 * `decor.place-setting`'s `defaultSize.height` or `modelSize.height` is ever
 * re-measured, recompute this from the 2.2908 file constant — do not scale 1.83.
 *
 * `ring.table` is deliberately NOT in this table: its cloth is flat at 75.00 file
 * cm out to r = 60 with a 0.05 cm edge fold, and the entry now declares a height
 * of 75 with the file's 75.05 stated as `modelSize` — so the loader's own fit puts
 * the cloth within 0.05 cm of the declared top, the fallback is already right to
 * within the model's Draco noise, and a row here would be false precision.
 *
 * ponytail: the right home for this is an optional `stackHeight` on CatalogEntry,
 * beside `defaultSize`/`modelSize` — it is a property of the product, not of the
 * editor, and the 2D view will want it the moment decor is drawn in section. It
 * lives here because src/core/catalog is PLAN-02's and was merged before this
 * plan started. Moving it is three steps: add the field, set 1.83 on
 * `decor.place-setting`, and have `stackHeight()` read `entry.stackHeight` with
 * this map deleted.
 */
const STACK_HEIGHTS: Record<string, number> = {
  'decor.place-setting': 1.83,
}

/**
 * The height, in the host's own frame, at which a rider stands on it.
 *
 * Scaled by the instance's size rather than taken flat from the table: the loader
 * fits the whole model to `size`, so a host that was resized carries its stacking
 * surface up or down with it and the rider follows.
 */
export function stackHeight(host: SceneObject): number {
  const declared = STACK_HEIGHTS[host.catalogId]
  if (declared === undefined) return host.size.height
  if (!hasCatalogEntry(host.catalogId)) return declared
  const base = getCatalogEntry(host.catalogId).defaultSize.height
  return base > 0 ? declared * (host.size.height / base) : declared
}

/**
 * WHERE on an item another item stands, in the host's OWN frame and in catalogue
 * centimetres at the host's `defaultSize` — the sideways twin of `STACK_HEIGHTS`.
 * Absent means "the host's origin", which is right for `ring.floral` on
 * `ring.table` (a disc centred on a disc) and for anything else stacked middle on
 * middle.
 *
 * `decor.place-setting` needs an entry because its PLATE is not at its origin. A
 * cover is a whole laid setting — plates, cutlery, two glasses — so the middle of
 * its bounding box falls between the plate and the cutlery, and a napkin pinned
 * there lands half on the plate and half on the knives. That is the "the napkins
 * are not laid on the plate" report (round-3 correction §13).
 *
 * MEASURED on public/props/decor-place-setting.glb, 2026-07-29 — the file the
 * catalog actually ships, NOT the Tripo source, whose own measurement gives the
 * same magnitudes with both signs flipped because glb-prep yaws the model on the
 * way in. `tools/glb-prep/measure-plate.mjs` is the measurement, re-runnable:
 * take the flat plateau at y = 2.29 file cm (the same surface STACK_HEIGHTS
 * reads), keep only its largest connected cluster in xz — a height slab alone is
 * NOT the plate, cutlery and a glass rim cross that height 20 cm away — and fit a
 * circle to the cluster's outer edge:
 *
 *   plate axis   FILE x = +1.855, z = -2.730 — least squares over 170 rim points,
 *                rms 0.09 cm. The midpoint of the cluster's bounding box agrees
 *                independently at +1.851 / -2.725.
 *   plate rim    a flat annulus, r = 12.97 … 14.39 file cm (569 vertices)
 *
 * File units become catalogue cm through the loader's per-axis fit, and plan y IS
 * glTF z with no sign flip (core/space.ts:55-57):
 *
 *   x:  1.855 * 36/45       = +1.48
 *   y: -2.730 * 31.3/39.14  = -2.18
 *
 * ponytail: the right home is an optional `stackOffset` on CatalogEntry beside
 * the `stackHeight` this pairs with — it is a property of the product, not of the
 * editor. Same three steps, same reason it is not there yet: src/core/catalog is
 * PLAN-02's and merged before this plan started.
 */
const STACK_OFFSETS: Record<string, Vec2> = {
  'decor.place-setting': { x: 1.48, y: -2.18 },
}

/**
 * The position a rider takes when it stands on `host`, in the host's PARENT frame.
 *
 * ONE function because there are TWO writers of this position and `mutateScene`
 * does not clamp surface children by itself — `clampSurfaceChildrenIn` is called
 * explicitly by the move/rotate/resize actions. `laySeatItems` writes the position
 * when the napkins are dropped and `clampToSurface` re-writes it on every later
 * clamp of the napkin, so if the two disagreed by the offset the napkin would sit
 * on the plate until the first drag and then jump to the middle of the cover.
 * Exactly why `stackHeight` is one function too.
 *
 * The offset is scaled by the host's own size, like `stackHeight`: the loader fits
 * the whole model to `size`, so a resized host carries its plate with it.
 */
export function stackedPosition(host: SceneObject): Vec2 {
  const declared = STACK_OFFSETS[host.catalogId]
  if (!declared) return { ...host.transform.position }
  let local = declared
  if (hasCatalogEntry(host.catalogId)) {
    const base = getCatalogEntry(host.catalogId).defaultSize
    local = {
      x: base.width > 0 ? declared.x * (host.size.width / base.width) : declared.x,
      y: base.depth > 0 ? declared.y * (host.size.depth / base.depth) : declared.y,
    }
  }
  // the offset lives in the HOST's frame, so it turns with the host — a cover on
  // the far side of a round table faces the other way (BRIEF §1.3: the rotation
  // goes through `rotateVec`, never a raw sin/cos)
  const turned = rotateVec(local, host.transform.rotation)
  return {
    x: host.transform.position.x + turned.x,
    y: host.transform.position.y + turned.y,
  }
}

/**
 * The elevation a surface child stands at, in its PARENT's frame — derived from
 * whatever it stands on rather than from the parent's height. Two riders need
 * this and they are not the same case:
 *
 *   napkin      -> place setting, which stands on the table top   -> 75 + 1.83
 *   ring.floral -> ring.table, which stands on the FLOOR through the ⌀380's hole
 *                  (`inHole`), so its own elevation is 0          ->  0 + 75
 *
 * Reading the host's own base is one rule for both, and for any future host
 * dropped into a hole; `parent.size.height + host.size.height` was right only for
 * the first and put the urn 75 cm above the table it is meant to stand on.
 *
 * Recomputed rather than read off `host.transform.elevation` so it cannot depend
 * on whether the host has already been clamped this pass — `clampSurfaceChildrenIn`
 * iterates in map order. The depth guard is for `stackedOn`, which is a stored
 * string a corrupt file could point round in a cycle.
 */
function surfaceBase(
  scene: SceneState,
  child: SceneObject,
  parent: SceneObject,
  depth = 0,
): number {
  if (child.attachment?.kind !== 'surface') return 0
  const hostId = child.attachment.stackedOn
  const host = hostId ? scene.objects[hostId] : undefined
  if (host && host.id !== child.id && host.parentId === child.parentId && depth < 4) {
    return surfaceBase(scene, host, parent, depth + 1) + stackHeight(host)
  }
  return child.attachment.inHole === true ? 0 : parent.size.height
}

/**
 * The middle of a table's TOP, in parent-local cm — where a `surfaceAnchor:'center'`
 * piece is pinned (source doc §28/§54b) and where a table design's authored origin
 * lands (§53).
 *
 * `{x: 0, y: 0}` for every entry in the catalog but one, and that is not a
 * coincidence to be tidied away later: a `footprint` outline is drawn symmetrically
 * about the object's origin, so on a disc, on a ring and on every rectangle the
 * origin IS the middle of the top. `state/tableCentre.test.ts` sweeps the whole
 * catalog for it, so this can never quietly start moving furniture on a table that
 * was fine.
 *
 * The serpentine is the exception, and its own file says why: its `outline` is a
 * conservative bounding RECT around an S-shaped band, and the box's centre falls in
 * the concave pocket of the S — `serpentineBandDepth({0,0})` is **−63.1 cm**, i.e.
 * 63 cm clear of the nearest drape edge, over the floor. Every centrepiece and all
 * four built-in designs were being laid there. It answers with the point on its
 * centre line at half its length instead.
 *
 * Matched on the entry's own `seats` function rather than on its id: that identity
 * is already the catalog's way of declaring "this table's geometry is not its
 * outline" (asserted as `entry.seats === serpentineSeats` in serpentine.test.ts), so
 * a second bounding-box table would have to make the same declaration to be caught
 * by this — where an id string would silently miss it.
 *
 * ponytail: the right home is an optional `topCentre` on `CatalogEntry` beside
 * `footprint`, so a table declares its own middle. It is here because
 * `src/core/catalog` belongs to PLAN-02 and merged before this plan started. Moving
 * it is one field, one line on `table.serpentine`, and deleting this function.
 */
export function surfaceCentre(entry: CatalogEntry): Vec2 {
  if (entry.seats !== serpentineSeats) return { x: 0, y: 0 }
  return serpentineCentre()
}

/**
 * Keep a surface-attached decor inside its parent's top outline, standing on the
 * parent's height. Positions are parent-local, so a circular table is a radial
 * clamp and a rect table a per-axis clamp.
 *
 * Both use the child's EXACT rotated extent. The old code collapsed a rotated
 * rect to its circumradius, which cost a 45×33 place setting 8.4cm on every
 * table — enough to drag a correctly laid-out setting off its seat.
 */
function clampToSurface(scene: SceneState, child: SceneObject): void {
  if (child.attachment?.kind !== 'surface' || !child.parentId) return
  const parent = scene.objects[child.parentId]
  if (!parent) return
  const entry = getCatalogEntry(child.catalogId)

  // stacked on another item (napkin on its place setting): it is PINNED to that
  // item — it rides along when the setting is nudged and cannot drift off it.
  // What it is pinned to is the host's stacking SURFACE, not the host's origin:
  // the place setting's plate sits off-centre, and a napkin at the origin lands
  // on the cutlery (see `stackedPosition`, and `laySeatItems`, which lays it on
  // the same point through the same function).
  const host = child.attachment.stackedOn ? scene.objects[child.attachment.stackedOn] : undefined
  if (host && host.parentId === child.parentId) {
    child.transform.position = stackedPosition(host)
    // The rotation is deliberately NOT re-asserted here. `child.rotation =
    // host.rotation` used to run on every clamp, which is why a napkin could
    // never be turned at all: it is LAID with the host's rotation (a rolled
    // napkin points at its guest, like the cover it dresses), and re-writing that
    // on the next clamp silently undid whatever the user had done. Nothing needs
    // the two locked together — a cover is laid per seat rather than posed by
    // hand (PLAN-09 item 11 makes settings non-editable), and both transforms are
    // PARENT-local, so rotating the TABLE turns cover and napkin as one without
    // either value moving.
    // NOT `parent.size.height + host.size.height`: the host's own base can be the
    // floor (ring.table sits in the ⌀380's hole) and its own STACKING surface can
    // be far below its total height (the place setting's 15 cm is its wine glass).
    // `surfaceBase` is both corrections in one rule — see its comment.
    child.transform.elevation = surfaceBase(scene, child, parent)
    return
  }

  // Source doc §28 pins a hand-placed centrepiece to the middle of the table.
  //
  // A DESIGN is exempt, and has to be: all four built-ins lay a candelabrum in
  // the centre with a pair of candlesticks at ±38 cm, and every saved design is
  // an arrangement by definition. Locking those to the centre would stack each
  // design into one point and quietly turn four designs into four single items.
  // Same rule the layouts already follow — authored content beats the placement
  // law, and the law governs what the user does by hand.
  const parentEntry = getCatalogEntry(parent.catalogId)
  const pOutline = parentEntry.footprint(parent.size).outline
  const cOutline = entry.footprint(child.size).outline
  const rot = child.transform.rotation
  const pos = child.transform.position

  if (entry.surfaceAnchor === 'center' && child.meta.design === undefined) {
    // On a ring table the two rules are the same place: the middle of the table
    // IS the opening (§48), so a centrepiece there stands on the floor and rises
    // through it. Anchoring it at table height instead would float it over a
    // hole. On a solid top the hole radius is 0 and this reads as before.
    const throughHole = holeRadius(pOutline) > 0
    child.attachment.inHole = throughHole || undefined
    // …and "the middle" is the middle of the TOP, which for every table but the
    // serpentine is the origin. See `surfaceCentre` (source doc §53, §54b).
    const mid = surfaceCentre(parentEntry)
    child.transform.position.x = mid.x
    child.transform.position.y = mid.y
    child.transform.elevation = throughHole ? 0 : parent.size.height
    return
  }

  const inHole = child.attachment.inHole === true
  if (pOutline.kind === 'circle') {
    const len = Math.hypot(pos.x, pos.y)
    // exact support of the rotated child along the radial direction
    let reach = cOutline.kind === 'circle' ? cOutline.r : 0
    if (cOutline.kind === 'rect') {
      const u = rotateVec(len > 0 ? { x: pos.x / len, y: pos.y / len } : { x: 1, y: 0 }, -rot)
      reach = (Math.abs(u.x) * cOutline.w + Math.abs(u.y) * cOutline.h) / 2
    }
    // A ring table has two disjoint places to stand, and which one this child
    // belongs to was decided at drop. Holding it there is what keeps a drag from
    // silently changing its elevation.
    const hole = holeRadius(pOutline)
    let maxR = Math.max(0, pOutline.r - reach)
    let minR = 0
    if (hole > 0) {
      if (inHole) {
        // fully inside the opening; an arrangement wider than the hole centres in
        // it and overhangs the top, which is what a real oversized piece does
        maxR = Math.max(0, hole - reach)
      } else {
        // off the top and clear of the opening — unless the ring is narrower than
        // the child, in which case the outer edge still wins over floating away
        minR = Math.min(hole + reach, maxR)
      }
    }
    if (len > maxR || len < minR) {
      const target = len > maxR ? maxR : minR
      // a child sitting exactly on centre has no radial direction to push along;
      // +x is arbitrary but stable, and only reachable when minR > 0
      const f = len > 0 ? target / len : 0
      pos.x = len > 0 ? pos.x * f : target
      pos.y = len > 0 ? pos.y * f : 0
    }
  } else {
    // rotated half-extents — the same formula outlineAABB uses
    const box = outlineAABB({ position: { x: 0, y: 0 }, rotation: rot, elevation: 0 }, cOutline)
    const maxX = Math.max(0, pOutline.w / 2 - box.maxX)
    const maxY = Math.max(0, pOutline.h / 2 - box.maxY)
    pos.x = Math.min(maxX, Math.max(-maxX, pos.x))
    pos.y = Math.min(maxY, Math.max(-maxY, pos.y))
  }
  // parent-local: the table group's origin is on the floor, so 0 puts the piece
  // through the opening and `height` puts it on the top
  child.transform.elevation = inHole ? 0 : parent.size.height
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

/**
 * The object already in the scene that forbids adding `catalogId`, or null when
 * it is free to place. Exported so the 2D ghost and the library can grey out a
 * blocked item instead of letting the user click and watch nothing happen.
 */
export function uniqueBlocker(scene: SceneState, catalogId: string): SceneObject | null {
  const tag = getCatalogEntry(catalogId).unique
  if (!tag) return null
  return (
    Object.values(scene.objects).find((o) => getCatalogEntry(o.catalogId).unique === tag) ?? null
  )
}

/**
 * `seating` overrides the catalog defaults before the chairs are reconciled —
 * how a table preset lands as one unit (its own chair model and seat count)
 * instead of a default table the caller then has to re-configure.
 *
 * A `unique` item that is already placed is refused (source doc §43: one chuppah
 * per event, hall or reception deck). Refusing returns the id of the object that
 * blocked it and selects that object, so the click reads as "here is the chuppah
 * you already have" — every caller either ignores the result or wants something
 * selected, and this keeps the signature non-nullable for the other 40 call sites.
 */
export function addObject(catalogId: string, position: Vec2, seating?: Partial<SeatingConfig>): Id {
  const blocker = uniqueBlocker(get().scene, catalogId)
  if (blocker) {
    select([blocker.id])
    return blocker.id
  }
  // the venue matters for placement:'ceiling' — without it a chandelier hangs at
  // the procedural 3.5m instead of the pack hall's 11.6m
  const obj = createObject(catalogId, position, get().scene.venue)
  if (obj.seating && seating) Object.assign(obj.seating, seating)
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
    if (obj.seating) {
      reconcileSeats(scene, obj.id)
      // the chairs are a different category — hiding it would swallow them silently
      unhideCategoryOf(scene, obj.seating.chairCatalogId)
    }
    clampToVenue(scene, [obj.id], 'legacy')
  })
  select([obj.id])
  return obj.id
}

/**
 * Does this drop have to lay its own host first, and may it?
 *
 * `lay` is the catalog id to put down before the rider; `refuse` is the reason
 * NOTHING may be put down. At most one of them is set, and both absent is the
 * ordinary case — an entry with no `autoHost`, or one whose host is already on
 * the table.
 *
 * ⚠ ONLY INTO A REAL OPENING. `holeRadius(parent) > 0` is a condition and not a
 * convenience: `requiresHost` says "this stands on that", it does not say the
 * host fits here. Laying a ⌀156 table on a ⌀180 top because the urn asked for one
 * would be inventing a piece of furniture the venue never puts there (BRIEF §1.1).
 * On a solid top the drop is refused as it always was, and the message now names
 * the inner table.
 *
 * Answered on the COMMITTED scene, before any producer opens — see the note on
 * `indexOf` in collision.ts.
 */
function autoHostFor(
  scene: SceneState,
  catalogId: string,
  parentId: Id,
): { lay?: string; refuse?: Violation } {
  const entry = getCatalogEntry(catalogId)
  const requires = entry.requiresHost
  if (!entry.autoHost || !requires) return {}
  const parent = scene.objects[parentId]
  if (!parent || parent.parentId) return {}
  if (holeRadius(getCatalogEntry(parent.catalogId).footprint(parent.size).outline) <= 0) return {}
  if (surfaceChildren(scene, parentId).some((c) => c.catalogId === requires)) return {}

  // A world-frame ghost of the host, which is the frame a drop speaks. The host is
  // `surfaceAnchor: 'center'`, so `siblingOverlaps` judges it at the middle of the
  // table and in the well — the spot `clampToSurface` is about to put it in, not
  // the pointer. Asking about the pointer would refuse a legal drop and allow an
  // illegal one, in both directions.
  const blocking = checkPlacement(scene, {
    catalogId: requires,
    transform: { position: worldCentreOf(parent), rotation: 0, elevation: 0 },
    size: getCatalogEntry(requires).defaultSize,
    parentId,
  })
  return blocking.length ? { refuse: blocking[0] } : { lay: requires }
}

/** The middle of a table's top in WORLD cm — where a centre-anchored piece lands. */
function worldCentreOf(parent: SceneObject): Vec2 {
  const mid = surfaceCentre(getCatalogEntry(parent.catalogId))
  const turned = rotateVec(mid, parent.transform.rotation)
  return {
    x: parent.transform.position.x + turned.x,
    y: parent.transform.position.y + turned.y,
  }
}

/**
 * Drop a surface-placement catalog item onto a table top. `worldPos` is the drop
 * point in plan space; the object becomes an attached child (kind 'surface'),
 * standing on the parent's height and clamped to its outline.
 *
 * An entry with `requiresHost` is LINKED to its host here, the same way
 * `laySeatItems` links a napkin to the setting it lays it on. Without the link
 * nothing marks `ring.floral` as standing on `ring.table`: both are
 * `surfaceAnchor: 'center'`, so both would be pinned to the middle of the ⌀380
 * table and dropped into its hole at elevation 0, and the urn would stand on the
 * FLOOR inside the small table rather than on top of it (source doc §46b).
 * `checkPlacement` already refuses the drop outright when no host is on the table
 * (collision.ts:576-580, `missingHost`), so the unlinked branch below is only
 * reachable from a direct call, which is not gated at all (06-collision-api §7.2).
 *
 * In practice that makes `ring.floral` the only entry the link touches: both
 * views send a `placement: 'seat'` entry (the cover and the three napkins) to
 * `addSeatItemsToTable` instead, which does its own linking
 * (Stage2D.tsx:393-397, Placement3D.tsx:119-129).
 *
 * ## `autoHost` — the drop that lays its own host
 *
 * An entry carrying `autoHost` beside `requiresHost` (only `ring.floral`) is not
 * refused on a bare table: the host is laid HERE, in the same producer, so the
 * gesture is one undo entry. Both drop paths already call this function
 * (Stage2D.tsx, Placement3D.tsx), so neither view needed a line.
 *
 * `autoHostFor` below decides, on the COMMITTED scene, whether to lay one — the
 * same rule every other gate in this file follows, and here it is also forced:
 * `checkPlacement` caches its obstacle index by scene identity, so it must never
 * be asked about a scene half-way through a mutation.
 */
export function addObjectToSurface(
  catalogId: string,
  parentId: Id,
  worldPos: Vec2,
  /** dropped through the open centre of a ring table — stands on the floor */
  inHole = false,
): Id | null {
  const bedding = autoHostFor(get().scene, catalogId, parentId)
  if (bedding.refuse) {
    // half a gesture is worse than none: laying the urn on nothing, or the table
    // and not the urn, leaves the user holding a state they did not ask for and
    // cannot name. Publish the reason the HOST could not go down — it is the real
    // obstacle, and the status bar says which one it is.
    refusal = bedding.refuse
    publishRefusal()
    return null
  }
  const obj = createObject(catalogId, { x: 0, y: 0 })
  let placed = false
  mutateScene((scene) => {
    const parent = scene.objects[parentId]
    if (!parent || parent.parentId) return
    if (bedding.lay) {
      const host = createObject(bedding.lay, { x: 0, y: 0 })
      host.parentId = parentId
      host.attachment = { kind: 'surface' }
      // seeded only, exactly like the rider below: `clampToSurface` is the
      // authority. It pins the piece to the middle of the table, sets `inHole`
      // from the PARENT's own opening and drops it to elevation 0 — so the well
      // and the table top stay one rule rather than two.
      host.transform = { position: { x: 0, y: 0 }, rotation: 0, elevation: parent.size.height }
      scene.objects[host.id] = host
      unhideCategoryOf(scene, host.catalogId)
      clampToSurface(scene, host)
    }
    const local = relativeTransform(parent.transform, {
      position: worldPos,
      rotation: parent.transform.rotation,
      elevation: 0,
    })
    obj.parentId = parentId
    obj.attachment = inHole ? { kind: 'surface', inHole: true } : { kind: 'surface' }
    const requires = getCatalogEntry(catalogId).requiresHost
    const host = requires
      ? surfaceChildren(scene, parentId).find((c) => c.catalogId === requires)
      : undefined
    if (host) obj.attachment.stackedOn = host.id
    obj.transform = {
      position: local.position,
      rotation: 0,
      // seeded only; `clampToSurface` below is the authority and re-derives it
      // through `surfaceBase` — including the stacked case just linked
      elevation: inHole ? 0 : parent.size.height,
    }
    scene.objects[obj.id] = obj
    unhideCategoryOf(scene, obj.catalogId)
    clampToSurface(scene, obj)
    placed = true
  })
  if (!placed) return null
  select([obj.id])
  return obj.id
}

/** A table's auto-laid place settings — the 'seat'-placement subset of its surface children. */
export function seatItems(scene: SceneState, tableId: Id): SceneObject[] {
  return surfaceChildren(scene, tableId).filter(
    (c) => getCatalogEntry(c.catalogId).placement === 'seat',
  )
}

/** Items standing ON `hostId` — a napkin dies with the place setting under it. */
function stackedOn(scene: SceneState, hostId: Id): SceneObject[] {
  return Object.values(scene.objects).filter(
    (o) => o.attachment?.kind === 'surface' && o.attachment.stackedOn === hostId,
  )
}

/** Delete a surface item and whatever is stacked on top of it. */
function deleteWithStack(scene: SceneState, item: SceneObject): void {
  for (const rider of stackedOn(scene, item.id)) delete scene.objects[rider.id]
  delete scene.objects[item.id]
}

/**
 * Lay one 'seat'-placement item (place setting) in front of EVERY chair of a table,
 * already turned to face its guest — the whole point is that a 22-seat table costs
 * one gesture instead of 44. Idempotent: an existing set is replaced, so re-dropping
 * after a seat-count change re-syncs the table in one click.
 *
 * The settings are plain one-shot children, deliberately NOT tracked like chairs:
 * a table can never be resized (every table entry is `resizable: []`) and chair depth
 * can never change (all six chairs share one CHAIR_SIZE), so nothing the reconciler
 * watches can invalidate them. Changing seat count or gap DOES leave them stale —
 * that is the case re-dropping recovers.
 *
 * An entry with `requiresHost` (the napkins) lays one copy per HOST instead of per
 * seat, pinned to it — so it inherits the settings' own layout for free, including
 * the serpentine's curve, and refuses outright when the table is bare (§27).
 * "Replace the previous set" is scoped to the same catalog id for the same reason:
 * dropping napkins must not sweep away the settings they stand on.
 */
export function addSeatItemsToTable(catalogId: string, tableId: Id): Id[] {
  const table0 = get().scene.objects[tableId]
  if (!table0?.seating || table0.parentId || isEffectivelyLocked(get().scene, table0)) {
    notify(strings.presets.designLocked)
    return []
  }
  let ids: Id[] = []
  mutateScene((scene) => {
    ids = laySeatItems(scene, catalogId, tableId)
  })
  pruneSelection() // the replaced set may have been selected
  return ids
}

/** The draft-level half of addSeatItemsToTable, so a replacement can re-lay in the same mutation. */
function laySeatItems(scene: SceneState, catalogId: string, tableId: Id): Id[] {
  const table = scene.objects[tableId]
  if (!table?.seating || table.parentId || isEffectivelyLocked(scene, table)) return []
  const ids: Id[] = []
  // scoped to the same catalog id: dropping napkins must not sweep away the
  // place settings they are about to stand on (source doc §27)
  for (const stale of seatItems(scene, tableId)) {
    if (stale.catalogId === catalogId) deleteWithStack(scene, stale)
  }

  const entry = getCatalogEntry(catalogId)
  const lay = (t: Transform2D, host?: SceneObject) => {
    const obj = createObject(catalogId, { x: 0, y: 0 })
    obj.parentId = tableId
    obj.attachment = host ? { kind: 'surface', stackedOn: host.id } : { kind: 'surface' }
    // the host's STACKING surface, not its total height: a napkin is laid on the
    // place setting's charger (1.83 cm), not on the rim of its wine glass (15 cm).
    // Same rule `clampToSurface` re-applies on every later clamp, so the two
    // cannot drift — that is what `stackHeight` being one function is for.
    //
    // The position is the same story one axis over: the plate is off-centre in
    // the cover, so `stackedPosition` — not the host's own point — is where the
    // napkin goes, and `clampToSurface` re-derives it from the same function.
    // It also hands back a fresh Vec2, where `{ ...t }` alone would leave the
    // napkin sharing the host's own position object.
    obj.transform = {
      ...t,
      position: host ? stackedPosition(host) : t.position,
      elevation: table.size.height + (host ? stackHeight(host) : 0),
    }
    scene.objects[obj.id] = obj
    ids.push(obj.id)
  }

  // an entry with `requiresHost` (the napkins) lays one copy per HOST rather than
  // per seat, so it inherits the settings' own layout — including the serpentine's
  // curve — and refuses outright on a bare table
  if (entry.requiresHost) {
    const hosts = seatItems(scene, tableId).filter((o) => o.catalogId === entry.requiresHost)
    if (!hosts.length) {
      refusal = { kind: 'missingHost', requires: entry.requiresHost }
      return ids
    }
    for (const host of hosts) lay(host.transform, host)
    unhideCategoryOf(scene, catalogId)
    return ids
  }

  const chair = getCatalogEntry(table.seating.chairCatalogId).defaultSize
  const tableEntry = getCatalogEntry(table.catalogId)
  // seatItemSeatsForEntry, not the outline math and not the raw seat list: on the
  // serpentine the seats follow the curve, and settings laid on rect positions
  // would float beside the table — and its two HEAD seats take a chair but not a
  // cover, because the two lie at 90° across the band and interpenetrate wherever
  // the head one is put (round 4 §15). Every other table gets all its seats back.
  const seats = seatItemSeatsForEntry(tableEntry, table.size, table.seating, chair)
  // the top goes with them (source doc §43): a seat knows the rim it sits outside
  // but not the RING's opening on the far side of it
  const top = tableEntry.footprint(table.size).outline
  for (const t of seatItemTransforms(
    seats,
    chair,
    entry.defaultSize,
    table.seating.offset,
    top,
    table.catalogId,
  )) {
    lay(t)
  }
  unhideCategoryOf(scene, catalogId)
  return ids
}

/**
 * Source doc §27: a napkin is laid ON the place setting, so taking the settings
 * away takes their napkins with them. `deleteWithStack` follows the `stackedOn`
 * link PLAN-03 introduced — before it existed this removed the settings alone and
 * left the napkins floating.
 */
export function removeSeatItems(tableId: Id): void {
  mutateScene((scene) => {
    for (const item of seatItems(scene, tableId)) deleteWithStack(scene, item)
  })
  pruneSelection()
}

// ---------------------------------------------------------------------------
// presets — ready-made layouts (core/presets.ts)
//
// Everything here is ONE mutateScene per user gesture, which is what makes a
// whole hall-fill or an apply-to-all a single undo entry. That is also why the
// design layer is a draft helper rather than an action calling an action.
// ---------------------------------------------------------------------------

/** Drop a table with its chairs already configured, as one unit. */
export function addTablePreset(presetId: string, position: Vec2): Id | null {
  const preset = getTablePreset(presetId)
  if (!preset) return null
  return addObject(preset.tableCatalogId, position, {
    chairCatalogId: preset.chairCatalogId,
    count: preset.seatCount,
  })
}

/**
 * Arrange as many preset tables as fit across the free floor. Additive: existing
 * furniture is treated as occupied and never moved or deleted, so running it
 * twice on a full hall is a no-op.
 */
export function fillHallWithTables(presetId: string): Id[] {
  const preset = getTablePreset(presetId)
  if (!preset) return []
  const scene0 = get().scene
  const { venue } = scene0
  const pack = getVenuePack(venue.venuePackId)
  const cell = tableCellSize(preset.tableCatalogId, presetSeating(preset))
  const occupied = scene0.objectOrder
    .map((id) => subtreeAABB(scene0, id))
    .filter((b): b is AABB => !!b)

  const slots = fillHallSlots({
    areas: pack?.floorAreas ?? [rectRing(0, 0, venue.size.width, venue.size.depth)],
    zones: pack?.restricted ?? [],
    cell,
    aisle: DEFAULT_AISLE,
    occupied,
    max: MAX_FILL,
  })
  if (!slots.length) return []

  const ids: Id[] = []
  mutateScene((scene) => {
    // number once up front — addObject's per-call rescan is O(n²) at this size
    let next =
      Math.max(
        0,
        ...Object.values(scene.objects)
          .filter((o) => o.seating)
          .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0)),
      ) + 1
    for (const position of slots) {
      const obj = createObject(preset.tableCatalogId, position, venue)
      if (obj.seating) {
        obj.seating.chairCatalogId = preset.chairCatalogId
        obj.seating.count = preset.seatCount
      }
      obj.meta.number = next++
      scene.objects[obj.id] = obj
      scene.objectOrder.push(obj.id)
      reconcileSeats(scene, obj.id)
      ids.push(obj.id)
    }
    unhideCategoryOf(scene, preset.tableCatalogId)
    unhideCategoryOf(scene, preset.chairCatalogId)
    clampToVenue(scene, ids, 'legacy')
  })
  select(ids)
  return ids
}

/** A table's design-placed decor — the tagged subset of its surface children. */
export function designItems(scene: SceneState, tableId: Id): SceneObject[] {
  return surfaceChildren(scene, tableId).filter((c) => c.meta.design !== undefined)
}

/**
 * Lay one design on one table, on the immer draft. Idempotent in the same way
 * addSeatItemsToTable is: the previous run is deleted before the new one lands,
 * so re-applying re-syncs instead of stacking. A design that lays place settings
 * also clears hand-dropped ones, which would otherwise double up at every seat;
 * a decor-only design leaves them alone.
 */
function layTableDesign(scene: SceneState, design: TableDesign, tableId: Id): Id[] {
  const table = scene.objects[tableId]
  if (!table?.seating || table.parentId || isEffectivelyLocked(scene, table)) return []
  const entry = getCatalogEntry(table.catalogId)
  // defensive: the line above already required `table.seating` and no parent, and
  // neither v13 arrival seats anyone. Asked the one way anyway (catalog/types.ts)
  if (!isFloorTable(entry)) return []

  for (const child of designItems(scene, tableId)) delete scene.objects[child.id]
  if (design.seatItem) for (const stale of seatItems(scene, tableId)) delete scene.objects[stale.id]

  // The table's own opening, read once. A design is exempt from the CENTRE rule
  // (§28) — that is what the `meta.design` tag buys it, and without the exemption
  // every arrangement would stack into one point. It is NOT exempt from the two
  // STOREYS (§48): a piece is either on the top or through the well, and which one
  // is a fact about where it LANDS.
  //
  // Until now `lay` wrote a bare `{ kind: 'surface' }`, so every design piece was
  // filed as "on the top" and `clampToSurface`'s ring clamp shoved it out to
  // `min(hole + reach, maxR)`. A piece at exactly (0, 0) has no radial direction,
  // so it took the arbitrary +x and landed straight on its own +x flanker —
  // measured for design.classic-gold on the ⌀380: centrepiece 0 → 96.4, flanker
  // 38 → 84.25, i.e. 12.5 cm of overlap, on every design, because the cause is the
  // clamp and not the arrangement.
  //
  // Decided from the point, exactly as a hand drop decides it (`pointInHole` in
  // layout/bounds.ts, in parent-local coordinates where the ring is centred on the
  // origin). Same rule, so the two paths cannot diverge.
  const pOutline = entry.footprint(table.size).outline
  const hole = holeRadius(pOutline)
  const ids: Id[] = []
  const lay = (catalogId: string, t: Transform2D) => {
    const obj = createObject(catalogId, { x: 0, y: 0 })
    obj.parentId = tableId
    obj.attachment =
      hole > 0 && Math.hypot(t.position.x, t.position.y) < hole
        ? { kind: 'surface', inHole: true }
        : { kind: 'surface' }
    obj.transform = { ...t, elevation: table.size.height }
    obj.meta.design = design.id
    scene.objects[obj.id] = obj
    unhideCategoryOf(scene, catalogId)
    clampToSurface(scene, obj)
    ids.push(obj.id)
  }

  // A design is authored around the table's ORIGIN — a centrepiece at (0,0) with a
  // pair of pieces either side of it. On the serpentine the origin is not on the
  // table at all, so the whole arrangement is carried to the middle of the band
  // rather than laid over the floor (source doc §53). `surfaceCentre` is (0,0) on
  // every other table, so every other design lays byte-for-byte as before.
  //
  // The offsets themselves are NOT rewritten: a design is an arrangement, and
  // re-spacing its flankers along a curve would make four authored designs into
  // four different ones. Measured after the shift, all twelve built-in pieces land
  // inside the band; three overhang the drape edge by 0.9-3.7 cm, which is inside
  // the model's own ±5 cm width wander — the numbers are in handoff/FOUND-07.md.
  const mid = surfaceCentre(entry)
  for (const item of design.items) {
    lay(item.catalogId, {
      position: { x: mid.x + (item.x ?? 0), y: mid.y + (item.y ?? 0) },
      rotation: item.rotation ?? 0,
      elevation: 0,
    })
  }
  if (design.seatItem) {
    const chair = getCatalogEntry(table.seating.chairCatalogId).defaultSize
    const item = getCatalogEntry(design.seatItem).defaultSize
    // the same subset the hand-laid path takes — a design's covers obey §15 too
    const seats = seatItemSeatsForEntry(entry, table.size, table.seating, chair)
    // same top as the hand-laid path — a design's settings obey §43 too
    const top = entry.footprint(table.size).outline
    for (const t of seatItemTransforms(
      seats,
      chair,
      item,
      table.seating.offset,
      top,
      table.catalogId,
    )) {
      lay(design.seatItem, t)
    }
  }
  return ids
}

/**
 * Why a design cannot be laid on this table, or null when it can. The three
 * reasons `layTableDesign` bails on used to be invisible: the click did nothing
 * and the user was left to guess (source doc §23).
 */
export type TableDesignBlock = 'missing' | 'locked' | 'notATable'

export function tableDesignBlock(scene: SceneState, tableId: Id): TableDesignBlock | null {
  const table = scene.objects[tableId]
  if (!table?.seating || table.parentId) return 'missing'
  if (isEffectivelyLocked(scene, table)) return 'locked'
  // defensive: guarded by `table.seating` two lines up, which no v13 arrival has
  if (!isFloorTable(getCatalogEntry(table.catalogId))) return 'notATable'
  return null
}

const DESIGN_BLOCK_MESSAGE: Record<TableDesignBlock, string> = {
  missing: strings.presets.designNoTable,
  locked: strings.presets.designLocked,
  notATable: strings.presets.designNoTable,
}

/**
 * A saved table design re-expressed as a TableDesign so one code path lays both.
 * Offsets are stored absolute but RESCALED by the size ratio of the captured
 * table to the target: a centrepiece 38cm off centre on a ⌀180 round belongs
 * ~80cm off centre on the ⌀380 one, not huddled by the middle.
 * A 'seat'-placement child becomes the design's `seatItem`, so the target's OWN
 * seat count and geometry decide how many are laid and where.
 */
function designFromSavedLayout(saved: SavedLayout, target: SceneObject): TableDesign | null {
  const subtree = saved.subtrees[0]
  if (!subtree) return null
  const sx = target.size.width / (subtree.root.size.width || target.size.width)
  const sy = target.size.depth / (subtree.root.size.depth || target.size.depth)
  const items: TableDesign['items'] = []
  let seatItem: string | undefined
  for (const child of subtree.children) {
    if (!hasCatalogEntry(child.catalogId)) continue
    if (getCatalogEntry(child.catalogId).placement === 'seat') {
      seatItem ??= child.catalogId
      continue
    }
    items.push({
      catalogId: child.catalogId,
      x: child.transform.position.x * sx,
      y: child.transform.position.y * sy,
      rotation: child.transform.rotation,
    })
  }
  if (!items.length && !seatItem) return null
  return { id: saved.id, labelKey: saved.name, items, seatItem }
}

export function applyTableDesign(designId: string, tableId: Id): Id[] {
  const design = getTableDesign(designId)
  if (!design) return []
  return layOne(design, tableId)
}

/** Lay a user-captured design (source doc §23) on one table. */
export function applySavedTableDesign(layout: SavedLayout, tableId: Id): Id[] {
  const table = get().scene.objects[tableId]
  const design = table ? designFromSavedLayout(layout, table) : null
  if (!design) return []
  return layOne(design, tableId)
}

function layOne(design: TableDesign, tableId: Id): Id[] {
  const block = tableDesignBlock(get().scene, tableId)
  if (block) {
    notify(DESIGN_BLOCK_MESSAGE[block])
    return []
  }
  const ids: Id[] = []
  mutateScene((scene) => {
    ids.push(...layTableDesign(scene, design, tableId))
  })
  pruneSelection()
  return ids
}

/** Same design on every table in the hall — one gesture, one undo entry. */
export function applyTableDesignToAll(designId: string): Id[] {
  const design = getTableDesign(designId)
  return design ? layAll(() => design) : []
}

export function applySavedTableDesignToAll(layout: SavedLayout): Id[] {
  return layAll((table) => designFromSavedLayout(layout, table))
}

function layAll(designFor: (table: SceneObject) => TableDesign | null): Id[] {
  const ids: Id[] = []
  mutateScene((scene) => {
    for (const id of [...scene.objectOrder]) {
      const obj = scene.objects[id]
      // defensive: `obj.seating` already excludes both v13 arrivals
      if (!obj?.seating || !isFloorTable(getCatalogEntry(obj.catalogId))) continue
      const design = designFor(obj)
      if (design) ids.push(...layTableDesign(scene, design, id))
    }
  })
  pruneSelection()
  if (!ids.length) notify(strings.presets.designLocked)
  return ids
}

/**
 * Source doc §23 — capture the decor the user arranged by hand on one table so
 * it can be re-laid on the others. Pure snapshot; storing it is the caller's job
 * (PresetsSection → indexedDbRepository).
 */
export function captureTableDesign(tableId: Id, name: string): SavedLayout | null {
  return createTableDesignLayout(name, get().scene, tableId)
}

/** Remove a design's decor only — hand-placed decor on the same table survives. */
export function removeTableDesign(tableId: Id): void {
  mutateScene((scene) => {
    for (const child of designItems(scene, tableId)) delete scene.objects[child.id]
  })
  pruneSelection()
}

/** Top-level fixtures placed by a hall design. */
function hallDesignIds(scene: SceneState): Id[] {
  return scene.objectOrder.filter((id) => scene.objects[id]?.meta.design !== undefined)
}

/**
 * The CEILING fixtures a hall design put in the scene — the set the two height
 * sliders move, read back from the tag `applyHallDesign` writes rather than from
 * the ids it returned, which go stale on the first undo.
 *
 * ⚠ Deliberately NARROWER than `hallDesignIds`, by the ceiling test. That one
 * feeds the DELETE paths of `applyHallDesign`/`removeHallDesign` and must not be
 * narrowed here — changing which objects a re-apply wipes is a risk with nothing
 * to do with this feature. This one feeds height WRITES, where the extra test
 * keeps a table's design-tagged decor out of the list; `setElevation` refuses
 * those anyway, so it is belt and braces on a read. The gap between the two is
 * logged in PLAN-06 §9.
 *
 * Was a private twin in `PresetsSection.tsx`; one place now.
 */
export function hallFixtureIds(scene: SceneState): Id[] {
  return scene.objectOrder.filter((id) => {
    const obj = scene.objects[id]
    return (
      !!obj &&
      obj.meta.design !== undefined &&
      hasCatalogEntry(obj.catalogId) &&
      getCatalogEntry(obj.catalogId).placement === 'ceiling'
    )
  })
}

export function hasHallDesign(scene: SceneState): boolean {
  return hallDesignIds(scene).length > 0
}

/**
 * Spread a ceiling fixture on a grid over the hall, replacing any previous hall
 * design. The cell is the FIXTURE plus a wall inset, not the spacing — sizing it
 * by spacing would leave a metres-wide bare border at every wall.
 */
export function applyHallDesign(designId: string): Id[] {
  const design = getHallDesign(designId)
  if (!design) return []
  const { venue } = get().scene
  const entry = getCatalogEntry(design.catalogId)
  const side = Math.max(entry.defaultSize.width, entry.defaultSize.depth) + 2 * CEILING_INSET
  const slots = fillHallSlots({
    areas: ceilingAreas(getVenuePack(venue.venuePackId), venue),
    zones: [],
    cell: { width: side, depth: side },
    aisle: Math.max(0, design.spacing - side),
    occupied: [],
    max: MAX_CEILING,
  })

  const ids: Id[] = []
  mutateScene((scene) => {
    for (const id of hallDesignIds(scene)) delete scene.objects[id]
    for (const position of slots) {
      const obj = createObject(design.catalogId, position, venue)
      obj.meta.design = design.id
      scene.objects[obj.id] = obj
      ids.push(obj.id)
    }
    scene.objectOrder = scene.objectOrder.filter((id) => !!scene.objects[id]).concat(ids)
    unhideCategoryOf(scene, design.catalogId)
  })
  pruneSelection()
  return ids
}

export function removeHallDesign(): void {
  mutateScene((scene) => {
    for (const id of hallDesignIds(scene)) delete scene.objects[id]
    scene.objectOrder = scene.objectOrder.filter((id) => !!scene.objects[id])
  })
  pruneSelection()
}

/** `meta.hangTier` read back as one of the three legal tiers. */
function storedTier(raw: unknown): HangTier {
  return raw === 1 ? 1 : raw === -1 ? -1 : 0
}

/**
 * Deal a tier to every fixture in `ids` that is missing one, in place.
 *
 * "If ONE is missing, roll them ALL" is safe because the group is all-or-none: a
 * fixture that lost its `meta` (only `replaceObject` does that) lost `meta.design`
 * with it and so left the group entirely. There is no in-between state. It is also
 * what makes a fresh design get a fresh draw for free — `applyHallDesign` deletes
 * and recreates, and new objects are born without a tier.
 */
function ensureHangTiers(scene: SceneState, ids: Id[]): void {
  if (ids.every((id) => typeof scene.objects[id].meta.hangTier === 'number')) return
  const tiers = rollHangTiers(ids.map((id) => scene.objects[id].transform.position))
  ids.forEach((id, i) => {
    scene.objects[id].meta.hangTier = tiers[i]
  })
}

/**
 * Height of the hall design's fixtures: one base for all of them, and on top of
 * it a symmetric scatter over three tiers `spread` cm wide.
 *
 * ONE mutation for the whole rig rather than `setElevation` in a loop. A slider
 * drag fires a tick per pixel, and N produce calls per tick over 40 fixtures is
 * 1600 fresh scenes for one drag.
 *
 * ⚠ The draw happens HERE and nowhere else, exactly once per fixture for its
 * whole life. After that the height is a pure function of (hangTier, base,
 * spread) — and that is what lets the user converge: dragging the slider stretches
 * the SAME pattern instead of rolling a new one. Re-rolling per tick is not a
 * feature, it is noise, and it is the failure this design exists to prevent.
 *
 * `clampHang` still runs inside `tierElevation`, so the elevation invariant holds
 * whatever base and spread are handed in.
 */
export function setHallHeights(base: number, spread: number): void {
  mutateScene((scene) => {
    const ids = hallFixtureIds(scene)
    if (!ids.length) return
    ensureHangTiers(scene, ids)
    const pack = getVenuePack(scene.venue.venuePackId)
    for (const id of ids) {
      const obj = scene.objects[id]
      // a locked fixture (or one on a locked layer) keeps its height, exactly as
      // `setElevation` already refuses it — PLAN-06 §9 notes that this is silent
      if (isEffectivelyLocked(scene, obj)) continue
      obj.meta.hangBase = base
      obj.meta.hangSpread = spread
      obj.transform.elevation = tierElevation(
        pack,
        scene.venue.wallHeight,
        obj.size.height,
        base,
        spread,
        storedTier(obj.meta.hangTier),
      )
    }
  })
}

/**
 * Draw the scatter again, keeping the fixtures where they are.
 *
 * Without it the only re-roll a user can ask for is clicking the design card a
 * second time — and `applyHallDesign` deletes and recreates, so that throws away
 * every fixture he had slid along its beam. This keeps the positions and changes
 * only which tier each one rides.
 */
export function reshuffleHallHeights(): void {
  mutateScene((scene) => {
    const ids = hallFixtureIds(scene)
    if (!ids.length) return
    for (const id of ids) delete scene.objects[id].meta.hangTier
    ensureHangTiers(scene, ids)
    const pack = getVenuePack(scene.venue.venuePackId)
    for (const id of ids) {
      const obj = scene.objects[id]
      if (isEffectivelyLocked(scene, obj)) continue
      // base and spread are whatever the rig already carries: this re-rolls the
      // pattern, it does not re-open the two sliders
      const base = typeof obj.meta.hangBase === 'number' ? obj.meta.hangBase : obj.transform.elevation
      const spread = typeof obj.meta.hangSpread === 'number' ? obj.meta.hangSpread : 0
      obj.transform.elevation = tierElevation(
        pack,
        scene.venue.wallHeight,
        obj.size.height,
        base,
        spread,
        storedTier(obj.meta.hangTier),
      )
    }
  })
}

// ---------------------------------------------------------------------------
// named hall layouts (core/hallLayouts.ts)
// ---------------------------------------------------------------------------

/**
 * Objects placed by a layout of one kind. Table layouts and lighting layouts
 * carry SEPARATE tags (schema v8) so that both can be applied at once — with one
 * shared `meta.layout` key, applying a lighting layout deleted the tables.
 */
function layoutIds(scene: SceneState, tag: string): Id[] {
  return scene.objectOrder.filter((id) => scene.objects[id]?.meta[tag] !== undefined)
}

export function hasHallLayout(scene: SceneState): boolean {
  return layoutIds(scene, LAYOUT_TAG.tables).length > 0
}

function appliedLayoutId(scene: SceneState, tag: string): string | null {
  const first = layoutIds(scene, tag)[0]
  const value = first ? scene.objects[first].meta[tag] : undefined
  return typeof value === 'string' ? value : null
}

/** The id of the currently applied table layout, or null. */
export function appliedHallLayoutId(scene: SceneState): string | null {
  return appliedLayoutId(scene, LAYOUT_TAG.tables)
}

/** The id of the currently applied saved lighting layout, or null. */
export function appliedLightingLayoutId(scene: SceneState): string | null {
  return appliedLayoutId(scene, LAYOUT_TAG.lighting)
}

/** Delete every object tagged by one layout kind, plus its children. */
function deleteLayout(scene: SceneState, tag: string): void {
  for (const id of layoutIds(scene, tag)) {
    if (isFrozen(scene.objects[id])) continue
    for (const child of childrenOf(scene, id)) delete scene.objects[child.id]
    delete scene.objects[id]
  }
  scene.objectOrder = scene.objectOrder.filter((id) => !!scene.objects[id])
}

const deleteHallLayout = (scene: SceneState) => deleteLayout(scene, LAYOUT_TAG.tables)

/**
 * Apply-time overrides for a hall layout (source doc §22 — "לשנות עיצובים וסוג
 * כסאות לאותה פריסה"). Both are TRANSIENT: they decide what this one click
 * produces and are not remembered by the layout. A layout that carried its own
 * chair would need a field on `SavedLayout`, which is a model change — see
 * PLAN-04 gate 2.
 */
export interface HallLayoutOptions {
  /** replaces the chair each preset bakes into its id (`TABLE_PRESETS`) */
  chairCatalogId?: string
  /** a `TABLE_DESIGNS` id, laid on every table this layout places */
  designId?: string
}

/**
 * Place a named layout's tables at their authored positions, replacing any
 * previous layout (tag-scoped, like applyHallDesign) — hand-placed furniture is
 * never touched, and collisions with it are not auto-resolved: the authored
 * positions win, and the expected flow is layout first, personal touches after.
 * One mutateScene = one undo entry — the overrides are applied INSIDE it, so
 * choosing a chair and a design still costs the user exactly one Ctrl+Z.
 */
export function applyHallLayout(layoutId: string, options: HallLayoutOptions = {}): Id[] {
  const layout = getHallLayout(layoutId)
  if (!layout) return []
  const { venue } = get().scene
  // Resolved BEFORE the draft is opened: an id the catalog does not have would
  // otherwise throw out of getCatalogEntry halfway through the loop, and immer
  // would discard the whole mutation — a click that deleted the previous layout
  // and put nothing back.
  const chairOverride =
    options.chairCatalogId && hasCatalogEntry(options.chairCatalogId)
      ? options.chairCatalogId
      : undefined
  const design = options.designId ? getTableDesign(options.designId) : undefined
  const ids: Id[] = []
  mutateScene((scene) => {
    deleteHallLayout(scene)
    // number once up front — same O(n²) dodge as fillHallWithTables
    let next =
      Math.max(
        0,
        ...Object.values(scene.objects)
          .filter((o) => o.seating)
          .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0)),
      ) + 1
    for (const placement of layout.placements) {
      const preset = getTablePreset(placement.presetId)
      if (!preset) continue
      const chairId = chairOverride ?? preset.chairCatalogId
      const obj = createObject(preset.tableCatalogId, { x: placement.x, y: placement.y }, venue)
      obj.transform.rotation = placement.rotation ?? 0
      if (obj.seating) {
        obj.seating.chairCatalogId = chairId
        obj.seating.count = preset.seatCount
      }
      obj.meta.number = next++
      obj.meta[LAYOUT_TAG.tables] = layout.id
      scene.objects[obj.id] = obj
      scene.objectOrder.push(obj.id)
      reconcileSeats(scene, obj.id)
      // the decor rides the same draft, so `ids` stays the TABLES the layout
      // placed — its children are found through the parent, as everywhere else
      if (design) layTableDesign(scene, design, obj.id)
      unhideCategoryOf(scene, preset.tableCatalogId)
      unhideCategoryOf(scene, chairId)
      ids.push(obj.id)
    }
    clampToVenue(scene, ids, 'legacy')
  })
  pruneSelection()
  return ids
}

/**
 * Apply a user-saved selection at its authored coordinates, replacing only the
 * previous layout OF THE SAME KIND. Hand-placed objects survive, matching the
 * built-in hall-layout behaviour — and a saved lighting layout no longer wipes
 * the tables, because each kind owns its own tag (schema v8).
 *
 * Both refusal paths used to return [] in silence, which reads as a dead button.
 */
export function applySavedLayout(layout: SavedLayout): Id[] {
  const current = get().scene
  if (!sameVenueSignature(venueSignature(current.venue), layout.venue)) {
    notify(strings.presets.layoutVenueMismatch)
    return []
  }
  const missing = missingCatalogIds(layout)
  if (missing.length) {
    notify(strings.presets.layoutUnavailable)
    return []
  }
  const ids: Id[] = []
  mutateScene((scene) => {
    deleteLayout(scene, LAYOUT_TAG[layout.kind])
    ids.push(...instantiateSavedLayout(scene, layout))
    for (const id of ids) {
      const root = scene.objects[id]
      if (!root) continue
      unhideCategoryOf(scene, root.catalogId)
      for (const child of childrenOf(scene, id)) unhideCategoryOf(scene, child.catalogId)
    }
    clampToVenue(scene, ids, 'legacy')
  })
  pruneSelection()
  return ids
}

export function removeHallLayout(): void {
  mutateScene(deleteHallLayout)
  pruneSelection()
}

export function removeLightingLayout(): void {
  mutateScene((scene) => deleteLayout(scene, LAYOUT_TAG.lighting))
  pruneSelection()
}

export function removeObjects(ids: Id[]): void {
  mutateScene((scene) => {
    const toReconcile = new Set<Id>()
    for (const id of ids) {
      const obj = scene.objects[id]
      if (!obj) continue
      // locked (frozen, own flag or layer) protects from deletion too — unlock first
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
          // whatever stands on it goes too — a napkin without its setting is
          // exactly the state §27 forbids
          deleteWithStack(scene, obj)
        }
        continue
      }
      for (const child of childrenOf(scene, id)) delete scene.objects[child.id]
      delete scene.objects[id]
      scene.objectOrder = scene.objectOrder.filter((oid) => oid !== id)
    }
    for (const tableId of toReconcile) reconcileSeats(scene, tableId)
  })
  pruneSelection()
}

/**
 * Remove the complete object graph in one undo step, regardless of locks — with
 * the single exception of baked fixtures, which are part of the venue and not of
 * the event (source doc §16).
 */
export function clearAllObjects(): void {
  mutateScene((scene) => {
    const kept = Object.values(scene.objects).filter((obj) => isFrozen(obj))
    scene.objects = Object.fromEntries(kept.map((obj) => [obj.id, obj]))
    scene.objectOrder = scene.objectOrder.filter((id) => !!scene.objects[id])
  })
  pruneSelection()
  overlay.setPlacing(null)
  overlay.setGhost(null)
}

/**
 * Deep-copy one TOP-LEVEL object and its children into `scene` at `position`.
 *
 * Extracted from `duplicateObjects` so that mirror-with-copy is the same clone
 * (§5.1): the fixture flag cleared, the table renumbered, every child re-parented.
 * Three separate copies of that list is how one of them comes to forget the
 * renumbering.
 *
 * ⚠ Runs INSIDE the producer and takes the draft. It reads `scene.objects` for the
 * next table number, so the caller must not batch several clones and expect them
 * to share one — they must not.
 */
function cloneRoot(scene: SceneState, src: SceneObject, position: Vec2): Id {
  const copy: SceneObject = JSON.parse(JSON.stringify(src))
  copy.id = newId()
  // a copy of a fixture is ordinary furniture: the venue has one bar, not two
  copy.flags = { locked: false, visible: copy.flags.visible }
  copy.transform = { ...copy.transform, position: { x: position.x, y: position.y } }
  if (copy.seating) {
    const numbers = Object.values(scene.objects)
      .filter((o) => o.seating)
      .map((o) => (typeof o.meta.number === 'number' ? o.meta.number : 0))
    copy.meta.number = Math.max(0, ...numbers) + 1
  }
  scene.objects[copy.id] = copy
  scene.objectOrder.push(copy.id)
  unhideCategoryOf(scene, copy.catalogId)
  for (const child of childrenOf(scene, src.id)) {
    const childCopy: SceneObject = JSON.parse(JSON.stringify(child))
    childCopy.id = newId()
    childCopy.parentId = copy.id
    scene.objects[childCopy.id] = childCopy
  }
  return copy.id
}

/**
 * A one-per-scene item cannot be copied — and until now Ctrl+D on the chuppah
 * made a second one in silence, while `addObject` and `canReplaceObject` both
 * refused it (source doc §62/§43). Shared by duplicate, paste and mirror-copy so
 * the three cannot drift into three different answers.
 *
 * Returns the ids it will accept, and tells the user about the ones it dropped.
 */
function withoutUniqueDupes(scene: SceneState, srcs: SceneObject[]): SceneObject[] {
  const kept: SceneObject[] = []
  let refused = 0
  for (const src of srcs) {
    if (uniqueBlocker(scene, src.catalogId)) refused++
    else kept.push(src)
  }
  if (refused) notify(strings.status.uniqueNotCopied(refused))
  return kept
}

/**
 * `offset` is a DIRECTION as much as a distance. The copy lands on the first free
 * multiple of it, up to eight — because a copy dropped ON its original is not a
 * cosmetic problem: two overlapping pieces are both "already illegal", `ruled()`
 * switches enforcement off for BOTH, and from that moment either of them can be
 * dragged through a wall (§3.2, measured).
 *
 * It still NEVER refuses. When nothing along the ray is free the copy lands at
 * `offset` exactly as it always did — losing a copy is worse than landing tight,
 * and `clampToVenue(…, 'legacy')` keeps its side of the old contract untouched.
 */
export function duplicateObjects(ids: Id[], offset: Vec2 = { x: 50, y: 50 }): Id[] {
  const before = get().scene
  const sources = withoutUniqueDupes(
    before,
    // attached chairs are not duplicated alone
    ids.map((id) => before.objects[id]).filter((o): o is SceneObject => !!o && !o.parentId),
  )
  if (!sources.length) return []
  const step =
    firstLegalStep(
      before,
      sources.map((src) => ({
        candidate: {
          catalogId: src.catalogId,
          transform: src.transform,
          size: src.size,
          // the copy carries the original's chairs, so they are part of what must fit
          subtreeOf: src.id,
        },
        from: src.transform.position,
      })),
      offset,
      stepsToClear(before, sources, offset),
    ) ?? 1
  const newIds: Id[] = []
  mutateScene((scene) => {
    for (const src of sources) {
      const live = scene.objects[src.id]
      if (!live) continue
      newIds.push(
        cloneRoot(scene, live, {
          x: live.transform.position.x + offset.x * step,
          y: live.transform.position.y + offset.y * step,
        }),
      )
    }
    clampToVenue(scene, newIds, 'legacy')
  })
  if (newIds.length) select(newIds)
  return newIds
}

/**
 * Replacement is allowed only WITHIN a placement class (source doc §24: "an item
 * standing on a table cannot be swapped for one that belongs to the ceiling").
 * `placement` already names the four classes — floor / surface / seat / ceiling —
 * so the rule is one comparison, not a table of special cases.
 *
 * `zoneKind` is the second half of the same idea: a bar unit or a DJ booth is
 * clamped INTO its zone and can never leave it, so swapping it for a plain floor
 * item (or the reverse) would teleport the result. Same zone, or neither.
 */
export function canReplaceObject(scene: SceneState, id: Id, catalogId: string): boolean {
  const source = scene.objects[id]
  if (!source || source.catalogId === catalogId || isEffectivelyLocked(scene, source)) return false
  // swapping a chuppah for another chuppah is fine — it is the same one object;
  // a SECOND one is not (source doc §43)
  const blocker = uniqueBlocker(scene, catalogId)
  if (blocker && blocker.id !== id) return false
  const from = getCatalogEntry(source.catalogId)
  const to = getCatalogEntry(catalogId)
  if ((from.placement ?? 'floor') !== (to.placement ?? 'floor')) return false
  if ((from.zoneKind ?? null) !== (to.zoneKind ?? null)) return false
  if (!source.parentId) return true
  // attached: only table-top decor is swappable — a chair belongs to the reconciler
  return source.attachment?.kind === 'surface'
}

/** What a table was wearing before it was replaced, so it can be dressed again. */
interface TableDressing {
  /** the design tag, if the decor came from a table design */
  designId?: string
  /** hand-dropped place settings (a design's own settings ride along with designId) */
  seatItemCatalogId?: string
  /** hand-placed decor, positioned as a FRACTION of the old table's half-extents */
  decor: { catalogId: string; nx: number; ny: number; rotation: number }[]
}

function readDressing(scene: SceneState, tableId: Id): TableDressing {
  const table = scene.objects[tableId]
  const design = designItems(scene, tableId)[0]?.meta.design
  const settings = seatItems(scene, tableId)
  const halfW = Math.max(1, table.size.width / 2)
  const halfD = Math.max(1, table.size.depth / 2)
  return {
    designId: typeof design === 'string' ? design : undefined,
    seatItemCatalogId: design === undefined ? settings[0]?.catalogId : undefined,
    decor: surfaceChildren(scene, tableId)
      .filter(
        (child) =>
          child.meta.design === undefined &&
          getCatalogEntry(child.catalogId).placement !== 'seat',
      )
      .map((child) => ({
        catalogId: child.catalogId,
        nx: child.transform.position.x / halfW,
        ny: child.transform.position.y / halfD,
        rotation: child.transform.rotation,
      })),
  }
}

/**
 * Put the decor back on the replacement. A design is RE-RUN rather than copied:
 * `layTableDesign` lays it out against the new geometry, so a 12-seat square that
 * became a 13-seat round gets a correct ring instead of twelve stale offsets.
 * Hand-placed decor has no such recipe, so it keeps its normalised position and
 * is clamped back onto the new top.
 */
function applyDressing(scene: SceneState, tableId: Id, dressing: TableDressing): void {
  const table = scene.objects[tableId]
  if (!table) return
  const design = dressing.designId ? getTableDesign(dressing.designId) : null
  if (design) layTableDesign(scene, design, tableId)
  else if (dressing.seatItemCatalogId) laySeatItems(scene, dressing.seatItemCatalogId, tableId)

  const halfW = table.size.width / 2
  const halfD = table.size.depth / 2
  for (const item of dressing.decor) {
    const child = createObject(item.catalogId, { x: item.nx * halfW, y: item.ny * halfD })
    child.parentId = tableId
    child.attachment = { kind: 'surface' }
    child.transform.rotation = item.rotation
    child.transform.elevation = table.size.height
    scene.objects[child.id] = child
    unhideCategoryOf(scene, item.catalogId)
    clampToSurface(scene, child)
  }
}

/** Replace one object in place; identity and plan transform stay stable for both views. */
export function replaceObject(id: Id, catalogId: string): boolean {
  if (!canReplaceObject(get().scene, id, catalogId)) return false
  let replaced = false
  mutateScene((scene) => {
    if (!canReplaceObject(scene, id, catalogId)) return
    const source = scene.objects[id]
    const sourcePlacement = getCatalogEntry(source.catalogId).placement ?? 'floor'
    const replacement = createObject(catalogId, source.transform.position, scene.venue)
    const nextPlacement = getCatalogEntry(catalogId).placement ?? 'floor'
    // read the old table's decor BEFORE its children are deleted (source doc §25)
    const dressing = source.seating ? readDressing(scene, id) : null

    replacement.id = id
    replacement.name = source.name
    replacement.flags = { ...source.flags }
    replacement.transform.position = { ...source.transform.position }
    replacement.transform.rotation = source.transform.rotation
    if (sourcePlacement === nextPlacement) replacement.transform.elevation = source.transform.elevation

    if (source.parentId) {
      replacement.parentId = source.parentId
      replacement.attachment = source.attachment
      replacement.transform = { ...source.transform, position: { ...source.transform.position } }
    }

    replacement.meta = source.seating && replacement.seating ? { ...source.meta } : {}
    if (replacement.seating && typeof replacement.meta.number !== 'number') {
      const numbers = Object.values(scene.objects)
        .filter((object) => object.id !== id && object.seating)
        .map((object) => (typeof object.meta.number === 'number' ? object.meta.number : 0))
      replacement.meta.number = Math.max(0, ...numbers) + 1
    }

    for (const child of childrenOf(scene, id)) delete scene.objects[child.id]
    scene.objects[id] = replacement
    unhideCategoryOf(scene, catalogId)
    if (replacement.seating) {
      reconcileSeats(scene, id)
      unhideCategoryOf(scene, replacement.seating.chairCatalogId)
      if (dressing) applyDressing(scene, id, dressing)
    }
    if (replacement.parentId) clampToSurface(scene, replacement)
    else clampToVenue(scene, [id])
    replaced = true
  })
  if (replaced) pruneSelection() // the old decor may have been drilled into
  return replaced
}

export interface Subtree {
  root: SceneObject
  children: SceneObject[]
}

/**
 * Insert cloned subtrees (paste). Positions move by centroid→target or +50cm.
 *
 * Same two rules as `duplicateObjects` and for the same reasons: a `unique` root
 * is dropped rather than pasted as a second one, and a plain +50/+50 paste walks
 * along its own offset until it finds floor instead of landing inside what it was
 * copied from. A paste AT A TARGET does not walk — the user named the spot, and
 * sliding away from an aimed drop would be the app moving furniture behind his
 * back, which is the whole complaint source doc §57 records.
 */
export function pasteSubtrees(subtrees: Subtree[], target?: Vec2): Id[] {
  if (!subtrees.length) return []
  const before = get().scene
  const roots = withoutUniqueDupes(before, subtrees.map((s) => s.root))
  const kept = subtrees.filter((s) => roots.includes(s.root))
  if (!kept.length) return []
  const cx = kept.reduce((a, s) => a + s.root.transform.position.x, 0) / kept.length
  const cy = kept.reduce((a, s) => a + s.root.transform.position.y, 0) / kept.length
  const offset = target ? { x: target.x - cx, y: target.y - cy } : { x: 50, y: 50 }
  const step = target
    ? 1
    : (firstLegalStep(
        before,
        kept.map((s) => ({
          candidate: {
            catalogId: s.root.catalogId,
            transform: s.root.transform,
            size: s.root.size,
          },
          from: s.root.transform.position,
        })),
        offset,
        // the pasted roots are not in the scene, so the reach is measured off the
        // originals still standing there — the same objects, byte for byte
        stepsToClear(before, kept.map((s) => s.root).filter((r) => !!before.objects[r.id]), offset),
      ) ?? 1)
  const delta = { x: offset.x * step, y: offset.y * step }
  const newIds: Id[] = []
  mutateScene((scene) => {
    for (const st of kept) {
      const root: SceneObject = JSON.parse(JSON.stringify(st.root))
      root.id = newId()
      root.parentId = null
      root.flags = { locked: false, visible: root.flags.visible } // never paste a fixture as a fixture
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
    clampToVenue(scene, newIds, 'legacy')
  })
  select(newIds)
  return newIds
}

// ---------------------------------------------------------------------------
// transforms
// ---------------------------------------------------------------------------

/**
 * `ignoreIds` — objects that must NOT count as obstacles for this move.
 *
 * One caller passes it: the 2D Alt+drag, which duplicates in place and then drags
 * the ORIGINALS (`editor2d/dragController.ts`). Without it the original stands
 * inside its own fresh copy, `ruled()` reads `false` on every frame, and the whole
 * gate is off — measured, that let a serpentine be dragged to x = −4300 in a hall
 * that runs 0…6051. It is a full, 100%-reliable gate bypass in one gesture, and it
 * is a documented feature of the app.
 *
 * Optional third parameter, so the other twenty-odd callers are untouched.
 */
export function moveObjectsBy(ids: Id[], delta: Vec2, ignoreIds?: Id[]): void {
  // The gate runs on the COMMITTED scene, before the producer opens: inside it
  // every read of the 350-odd objects would go through an immer proxy, which
  // measured as the dominant cost of a drag frame — see `indexOf` in collision.ts.
  const before = get().scene
  const step = allowedDelta(before, editable(before, ids), delta, ignoreIds)
  mutateScene((scene) => {
    const objs = editable(scene, ids)
    for (const obj of objs) {
      if (obj.parentId) {
        const parent = scene.objects[obj.parentId]
        // `step`, not `delta`: since PLAN-06 a child IS ruled — it collides with its
        // siblings on the table — and `allowedDelta` already probed it in the parent's
        // frame. Applying the full delta here would let decor slide through decor on
        // the commonest drag path in the app while every other path stayed gated.
        const local = parent ? rotateVec(step, -parent.transform.rotation) : step
        obj.transform.position.x += local.x
        obj.transform.position.y += local.y
        if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
      } else {
        obj.transform.position.x += step.x
        obj.transform.position.y += step.y
      }
    }
    clampToVenue(scene, ids)
    clampSurfaceChildrenIn(scene, ids)
  })
}

export function setPosition(id: Id, position: Vec2): void {
  // gate on the committed scene, then mutate — see `indexOf` in collision.ts
  const before = get().scene
  const source = before.objects[id]
  let landing = position
  if (source && !isEffectivelyLocked(before, source) && ruled(before, source)) {
    const target = { ...source.transform, position }
    const blocking = checkPlacement(before, candidateFor(source, { transform: target }))
    if (blocking.length) {
      refusal = blocking[0]
      // 3D drag and the inspector both land here: slide up to the obstacle
      // rather than ignoring the gesture outright
      const legal = slideToLegal(
        before,
        candidateFor(source, { transform: target }),
        source.transform.position,
      )
      if (!legal) {
        publishRefusal()
        return
      }
      landing = legal
    }
  }
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || isEffectivelyLocked(scene, obj)) return
    obj.transform.position = { ...landing }
    if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    clampToVenue(scene, [id])
    clampSurfaceChildrenIn(scene, [id])
  })
}

export function setRotation(id: Id, rotation: number): void {
  const before = get().scene
  const source = before.objects[id]
  if (source && !isEffectivelyLocked(before, source)) {
    if (!poseAllowed(before, source, { transform: { ...source.transform, rotation } })) {
      publishRefusal()
      return
    }
  }
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || isEffectivelyLocked(scene, obj)) return
    obj.transform.rotation = rotation
    if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    clampToVenue(scene, [id])
    clampSurfaceChildrenIn(scene, [id])
  })
}

/**
 * Drop height of a ceiling fixture (source doc §13). Only `placement: 'ceiling'`
 * has a free elevation — everything else derives it (floor 0, decor = the table's
 * height), so this refuses rather than letting the inspector desync a child.
 */
export function setElevation(id: Id, elevation: number): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (!obj || obj.parentId || isEffectivelyLocked(scene, obj)) return
    if (getCatalogEntry(obj.catalogId).placement !== 'ceiling') return
    obj.transform.elevation = clampHang(
      getVenuePack(scene.venue.venuePackId),
      scene.venue.wallHeight,
      obj.size.height,
      elevation,
    )
  })
}

/**
 * Turn a selection, judging each member on its own.
 *
 * This used to be all-or-nothing across the GROUP: one member with no legal pose
 * at the new angle cancelled the rotation for everybody — and did it in complete
 * silence, which from the outside is indistinguishable from a gizmo stuck on
 * detents (PLAN-09 item 15, and very likely part of what was reported as "the
 * rotation is stuck"). Now everything that can turn turns, and the ones that
 * cannot are counted out loud.
 *
 * `poseAllowed` is still ALL-OR-NOTHING PER OBJECT, on purpose: an angle has no
 * "slide to the nearest legal spot" the way a move does, so a single piece either
 * takes the new pose or keeps the old one. Only the group verdict changed.
 *
 * Children (anything with a `parentId`) are rotated but never probed — as before.
 * Their legality is a parent-local question, and `clampSurfaceChildrenIn` settles
 * it after the write.
 */
export function rotateObjectsBy(ids: Id[], delta: number): void {
  const before = get().scene
  const targets = editable(before, ids)
  const turning = targets
    .filter(
      (obj) =>
        !!obj.parentId ||
        poseAllowed(before, obj, {
          transform: { ...obj.transform, rotation: normalizeDeg(obj.transform.rotation + delta) },
        }),
    )
    .map((obj) => obj.id)
  const refusedCount = targets.length - turning.length
  if (refusedCount) notify(strings.status.rotationRefused(refusedCount))
  // nothing survived the probe: no scene write, so the pill carries the reason
  if (refusedCount && !turning.length) {
    publishRefusal()
    return
  }
  mutateScene((scene) => {
    for (const obj of editable(scene, turning)) {
      // normalized, or `R` pressed all afternoon walks the inspector up to 3600°
      obj.transform.rotation = normalizeDeg(obj.transform.rotation + delta)
      if (obj.attachment?.kind === 'seat') obj.attachment.manual = true
    }
    clampToVenue(scene, turning)
    clampSurfaceChildrenIn(scene, turning)
  })
}

/**
 * Reflect each selected TOP-LEVEL object about its own local x-axis.
 *
 * The children are deliberately NOT touched. `mirrored` composes
 * (`core/space.ts`), so a table's chairs, its place settings and every piece of a
 * laid design land where a real mirrored table's would, from one bit on the
 * parent. Writing the reflection into each child instead would have to survive
 * `reconcileSeats`, which rewrites every non-manual chair from the catalog's own
 * seat walk on the next edit — it would undo itself.
 *
 * A child id passed in is ignored rather than refused: a mirrored place setting
 * on an unmirrored table is not a thing the user can mean, and the selection
 * often holds both after a drill-in.
 *
 * The gate is per object and mirrors `rotateObjectsBy`'s: a mirror MOVES the
 * chairs, so it can genuinely become illegal even though the table's own outline
 * is symmetric about the axis it is reflected in — which is why nothing here
 * special-cases collision.
 */
export function mirrorObjects(ids: Id[]): void {
  const before = get().scene
  const targets = editable(before, ids).filter((obj) => !obj.parentId)
  const turning = targets
    .filter((obj) =>
      poseAllowed(before, obj, {
        transform: { ...obj.transform, mirrored: !obj.transform.mirrored },
      }),
    )
    .map((obj) => obj.id)
  const refusedCount = targets.length - turning.length
  if (refusedCount) notify(strings.status.mirrorRefused(refusedCount))
  if (refusedCount && !turning.length) {
    publishRefusal()
    return
  }
  mutateScene((scene) => {
    for (const obj of editable(scene, turning)) {
      // deleted rather than set to false — an unmirrored object must serialise
      // exactly as it did before the flag existed (see Transform2D.mirrored)
      if (obj.transform.mirrored) delete obj.transform.mirrored
      else obj.transform.mirrored = true
    }
    clampToVenue(scene, turning)
    clampSurfaceChildrenIn(scene, turning)
  })
}

/**
 * Reflect a copy and leave the original standing — the user's own words, "COPY
 * MIRROR". Returns the new ids.
 *
 * ## Why this is not `duplicateObjects()` + `mirrorObjects()`
 *
 * Three reasons, and the second is the one that would have shipped a bug:
 *
 *  1. two mutations are two undo entries, so the pair would need a
 *     `beginGesture`/`endGesture` wrapper; one `mutateScene` gets one entry free;
 *  2. `mirrorObjects` runs `poseAllowed` and CAN refuse. The copy would already
 *     exist, unmirrored — half a gesture the user has to undo by hand;
 *  3. the gate belongs on the FINAL pose (copied AND reflected), once, not on two
 *     intermediate ones.
 *
 * ## Where the copy lands, and why it is not +50/+50
 *
 * Reflected about the original's own right-hand edge, in the original's frame:
 *
 *     d  = outline width + aisle          aisle = the table clearance, or 0
 *     at = position + rotateVec({x: d, y: 0}, rotation)
 *
 * That is what "mirror with copy" means in every CAD tool — the natural axis is
 * the object's own edge — and it is what makes the result a symmetric PAIR, which
 * is the thing people build when they ask for this. `duplicateObjects`' +50/+50
 * on a 477 cm table would put the reflection INSIDE the original, which is exactly
 * the overlap that switches the gate off for both pieces (§3.2). The aisle rather
 * than 0 because two tables touching on the mirror line refuse every later move of
 * either one on `spacing`.
 *
 * ⚠ On the serpentine the outline is 422 wide while the band neither fills it nor
 * sits centred in it, so a mirrored pair shows a wider visual gap than the rule
 * needs. That is consistent and predictable, and the user can drag the copy in —
 * the gate stops it exactly on the legal aisle. Do NOT "tighten" it off the band:
 * that would make the offset per-entry and unpredictable for the whole catalog.
 *
 * ## Gating
 *
 * No `poseAllowed`. This is a COPY operation and §4.3(1) governs it: it never
 * refuses, it walks its own axis looking for floor, and if it finds none the copy
 * lands anyway. `unique` is blocked, because Ctrl+D on the chuppah and
 * mirror-copy of the chuppah have to answer the same way.
 *
 * A LOCKED source is copied — `duplicateObjects`' rule, not `mirrorObjects`': the
 * copy is a new, unlocked object and nothing about the original changes. A child
 * in the selection is skipped rather than refused, which is `mirrorObjects`' rule,
 * because after a drill-in the selection routinely holds both.
 */
export function mirrorCopyObjects(ids: Id[]): Id[] {
  const before = get().scene
  const sources = withoutUniqueDupes(
    before,
    ids.map((id) => before.objects[id]).filter((o): o is SceneObject => !!o && !o.parentId),
  )
  if (!sources.length) return []

  // Solved per object, unlike `duplicateObjects`' single shared step: each source
  // reflects about ITS OWN edge along ITS OWN heading, so there is no one vector a
  // group could share.
  const landings = sources.map((src) => {
    const entry = getCatalogEntry(src.catalogId)
    const outline = entry.footprint(src.size).outline
    const width = outline.kind === 'circle' ? outline.r * 2 : outline.w
    const aisle = isFloorTable(entry) ? clearanceOf(entry, outline) : 0
    const dir = rotateVec({ x: width + aisle, y: 0 }, src.transform.rotation)
    const from = src.transform.position
    const candidate: PlacementCandidate = {
      catalogId: src.catalogId,
      transform: { ...src.transform, mirrored: !src.transform.mirrored },
      size: src.size,
      // the copy brings the original's chairs — reflected, since `composeTransform`
      // reads the flag — so they are part of what has to fit
      subtreeOf: src.id,
    }
    return {
      id: src.id,
      at: firstLegalAlong(before, candidate, from, dir) ?? { x: from.x + dir.x, y: from.y + dir.y },
    }
  })

  const newIds: Id[] = []
  mutateScene((scene) => {
    for (const { id, at } of landings) {
      const live = scene.objects[id]
      if (!live) continue
      const copyId = cloneRoot(scene, live, at)
      const copy = scene.objects[copyId]
      // deleted rather than set to false — an unmirrored object must serialise
      // exactly as it did before the flag existed (see Transform2D.mirrored)
      if (live.transform.mirrored) delete copy.transform.mirrored
      else copy.transform.mirrored = true
      newIds.push(copyId)
    }
    clampToVenue(scene, newIds, 'legacy')
  })
  if (newIds.length) select(newIds)
  return newIds
}

export function setSize(id: Id, size: Partial<Size3D>): void {
  const before = get().scene
  const source = before.objects[id]
  if (source && !isEffectivelyLocked(before, source)) {
    const target = clampSize(source.catalogId, { ...source.size, ...size })
    if (!poseAllowed(before, source, { size: target })) {
      publishRefusal()
      return
    }
  }
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

// ---------------------------------------------------------------------------
// appearance, naming, flags, order
// ---------------------------------------------------------------------------

/**
 * ⚠ MERGES into the slot record. It used to REPLACE it (`obj.appearance[slot] =
 * { color }`), which was harmless while `color` was the only field on it and is
 * silent data loss now: picking a colour would wipe the texture the user had just
 * chosen, and — worse — an absent `textureId` reads as "use the catalogue
 * default", so a napkin would not merely lose the swatch but jump back to the
 * weave the entry declares. Writing only the key this action owns is what keeps
 * the two pickers independent.
 */
export function setAppearance(ids: Id[], slot: string, color: string): void {
  mutateScene((scene) => {
    for (const obj of editable(scene, ids)) {
      if (!isEditableSlot(getCatalogEntry(obj.catalogId), slot)) continue
      const record = obj.appearance[slot] ?? (obj.appearance[slot] = {})
      record.color = color
    }
  })
}

/**
 * The other half of an appearance: which fabric swatch a slot wears.
 *
 * `null` is a VALUE, not a delete — "no texture", which is not the same as an
 * absent key ("whatever the slot's `defaultTexture` says"). Clearing a napkin's
 * weave has to survive a reload, so it is stored rather than removed; see the
 * three-state note on `AppearanceOverrides`.
 *
 * Two guards, and the second is the load-bearing one: `isEditableSlot` is the
 * same permission the colour action asks, and `isTextureId` is what keeps an
 * unknown id out of the scene — a stored id becomes a URL, so an unvalidated one
 * is a path the renderer would try to fetch and the picker would put in an
 * `<img src>`.
 */
export function setSlotTexture(ids: Id[], slot: string, textureId: string | null): void {
  if (textureId !== null && !isTextureId(textureId)) return
  mutateScene((scene) => {
    for (const obj of editable(scene, ids)) {
      if (!isEditableSlot(getCatalogEntry(obj.catalogId), slot)) continue
      const record = obj.appearance[slot] ?? (obj.appearance[slot] = {})
      record.textureId = textureId
    }
  })
}

export function setName(id: Id, name: string): void {
  mutateScene((scene) => {
    const obj = scene.objects[id]
    if (obj) obj.name = name
  })
}

/** A frozen fixture's lock cannot be opened — that is what makes it permanent. */
export function setLocked(ids: Id[], locked: boolean): void {
  mutateScene((scene) => {
    for (const id of ids) {
      const obj = scene.objects[id]
      if (obj && !isFrozen(obj)) obj.flags.locked = locked
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
    clampToVenue(scene, ids, 'legacy')
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
    clampToVenue(scene, ids, 'legacy')
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

export function updateSettings(patch: Partial<SceneSettings>): void {
  mutateScene((scene) => {
    Object.assign(scene.settings, patch)
  })
}

/** Patch outdoor lighting, materializing the default on first touch. */
export function setLighting(patch: Partial<LightingSettings>): void {
  mutateScene((scene) => {
    scene.settings.lighting = { ...lightingOf(scene), ...patch }
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

/**
 * Switch the work area between the hall and the raised reception deck. A view
 * preference, not scene data — deliberately outside `mutateScene` so it neither
 * dirties the project nor lands in undo.
 */
export function setActiveZone(activeZone: ActiveZone): void {
  set((state) => {
    state.activeZone = activeZone
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
