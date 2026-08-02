/**
 * Placement legality — the single answer to "may this object stand here?".
 *
 * Everything that can refuse a placement lives here and nowhere else: overlap,
 * table-to-table clearance, venue bounds, no-go zones, the catalog's own siting
 * rules and the one-per-scene tag. `checkPlacement` returns the REASONS rather
 * than a boolean so the ghost can be red AND say why, which is the whole point
 * of the change (source doc §57: the old ghost was green over the pool and the
 * item was silently shoved out afterwards).
 *
 * Two invariants callers depend on:
 *
 *  - It is a QUESTION, never a mutation. Nothing here touches the scene, so it
 *    is safe to call inside an immer producer and on every drag frame.
 *  - An empty array means legal. There is no severity ordering; the first
 *    element is simply what the status bar shows.
 *
 * Enforcement is NOT retroactive — that decision lives in state/actions.ts,
 * which skips the gate for an object that is already illegal where it stands.
 * A project saved before these rules existed must load exactly as it was.
 */
import { getCatalogEntry } from '../catalog/registry'
import {
  isFloorTable,
  type CatalogEntry,
  type FootprintPart,
  type Outline,
} from '../catalog/types'
import type { Id, SceneObject, SceneState, Size3D, Transform2D, Vec2 } from '../model/types'
import { composeTransform, relativeTransform, rotateVec } from '../space'
import { getVenuePack, type RestrictedZone } from '../venuePacks'
import { aabbIntersects, holeRadius, pointInHole, type AABB } from './bounds'
import { arcBandTiles } from './serpentine'

/** Why a placement is refused — one per reason, in no particular order. */
export type Violation =
  | { kind: 'collision'; withId: Id }
  | { kind: 'spacing'; withId: Id; actual: number; required: number }
  | { kind: 'outOfBounds' }
  | { kind: 'forbiddenZone'; zone: string }
  | { kind: 'wrongZone'; allowed: string[] }
  /**
   * Not in the original seven: source doc §8 ("vegetation 2 goes only against
   * walls") needs a reason of its own, and folding it into `wrongZone` would
   * make the status bar say "allowed only in —" with nothing to name.
   */
  | { kind: 'nearWall'; within: number }
  | { kind: 'missingHost'; requires: string }
  /**
   * Two items on the SAME table top standing in one another. Not `collision`,
   * whose `withId` names a top-level obstacle on the venue floor: a table top is
   * a different space with different rules, and the status bar says so.
   */
  | { kind: 'overlapsSibling'; id: Id }
  | { kind: 'duplicate'; unique: string }

export interface PlacementCandidate {
  catalogId: string
  transform: Transform2D
  size: Size3D
  /**
   * The object(s) this candidate REPLACES, excluded from the obstacle set. A
   * list, not just an id, because a multi-selection drags as one unit: checking
   * member A against member B's pre-move position would refuse every group move
   * that started out tight.
   */
  excludeId?: Id | Id[]
  /**
   * The existing object whose attached CHAIRS travel with this candidate — a
   * table's footprint is the table plus its seats, and forgetting them lets the
   * table stop at the wall with half its chairs through it.
   *
   * Defaults to `excludeId` when that is a single id, so the common
   * "this one object, moved" case needs only the one field. A group move must
   * name it, because there the exclusion list covers every member.
   */
  subtreeOf?: Id
  /** For a surface/seat item: the table it is being placed on (host lookup). */
  parentId?: Id
  /**
   * surface/seat only: `transform.position` is in the PARENT's local frame — an
   * existing child being probed, whose stored transform already lives there.
   * Absent = world frame, which is what the ghost of a new drop hands over
   * (editor2d/Stage2D.tsx, viewer3d/Placement3D.tsx). The sibling rule compares
   * in the parent's frame and converts the world case itself.
   */
  parentLocal?: boolean
  /**
   * surface/seat only: this item stands on the FLOOR through the open centre of a
   * ring table rather than on its top (`Attachment.surface.inHole`).
   *
   * Pass it for an existing child; it is decided once at drop (model/types.ts:40-56)
   * and re-deriving it mid-drag is exactly what would drop a piece 75cm between two
   * frames. Absent on a world-frame ghost means "work it out from the drop point",
   * which is the same test the drop itself runs.
   */
  inHole?: boolean
}

/**
 * Edge-to-edge clearance between two TABLES, in cm (source doc §37-38, decision
 * G6: measured between the table outlines, chairs excluded). A ring is a circle
 * carrying `rInner` (see handoff/02-ring-contract.md), so it lands on the same
 * 120 as any other round table — the key is kept for documentation.
 */
export const TABLE_CLEARANCE: Record<string, number> = {
  rect: 170,
  circle: 120,
  ring: 120,
}

/**
 * An entry may state its own aisle; otherwise it is read off the outline shape,
 * which is what every entry did before the field existed and what every entry
 * still does today (`CatalogEntry.clearance` is set nowhere — see its note).
 *
 * Exported for the same reason `TABLE_CLEARANCE` beside it is: with no entry
 * carrying the field, the fallback is the ONLY branch any scene can reach, and a
 * rule nothing exercises is a rule that has quietly stopped working by the time
 * somebody finally sets a number.
 */
export function clearanceOf(entry: CatalogEntry, outline: Outline): number {
  return entry.clearance ?? (outline.kind === 'rect' ? TABLE_CLEARANCE.rect : TABLE_CLEARANCE.circle)
}

// ---------------------------------------------------------------------------
// geometry — rotated rectangles and discs
// ---------------------------------------------------------------------------

/**
 * ⚠ A Shape is IMMUTABLE. `pts` is a cache filled when the shape is built and
 * never written afterwards — every field it is derived from is read-only in
 * practice, and a shape whose `x`/`rot` were nudged in place would keep serving
 * the old corners to every SAT test in this file. Build a new one instead.
 *
 * The cache exists because `cornersOf` allocates four objects and does two trig
 * calls per call, and it sat inside a loop `slideToLegal` runs up to fourteen
 * times per drag frame. Benchmarked on the dev machine, 2026-07-30, 2M rect↔rect
 * pairs (.tmp/bench-sat.mjs):
 *
 *   SAT with corners recomputed   546 ns
 *   SAT with corners cached       121 ns
 *   AABB reject alone             6.4 ns
 *
 * `pts` is optional so a hand-built shape (a test, a future caller) still works —
 * `cornersOf` falls back to computing them.
 */
type Shape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | {
      kind: 'rect'
      x: number
      y: number
      w: number
      h: number
      rot: number
      /** world corners, clockwise — the cache `cornersOf` reads */
      pts?: Vec2[]
    }

/** World corners, clockwise. Rotation goes through space.ts — never a raw sin/cos here. */
function computeCorners(s: { x: number; y: number; w: number; h: number; rot: number }): Vec2[] {
  const hw = s.w / 2
  const hh = s.h / 2
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const r = rotateVec(p, s.rot)
    return { x: s.x + r.x, y: s.y + r.y }
  })
}

/** The one constructor for a rect shape, so the corner cache is never forgotten. */
function rectShape(x: number, y: number, w: number, h: number, rot: number): Shape {
  return { kind: 'rect', x, y, w, h, rot, pts: computeCorners({ x, y, w, h, rot }) }
}

function cornersOf(s: Extract<Shape, { kind: 'rect' }>): Vec2[] {
  return s.pts ?? computeCorners(s)
}

function shapeOf(world: Transform2D, outline: Outline): Shape {
  const { x, y } = world.position
  return outline.kind === 'circle'
    ? { kind: 'circle', x, y, r: outline.r }
    : rectShape(x, y, outline.w, outline.h, world.rotation)
}

/**
 * Carry an object-LOCAL shape into world space. Rotation through space.ts.
 *
 * ⚠ THE MIRROR IS NOT COSMETIC HERE. `composeTransform` (core/space.ts:47-59)
 * already reflects a table's CHAIRS, and both renderers reflect the drape
 * (editor2d/ObjectNode.tsx `<Group scaleX={-1}>`, viewer3d/ObjectGroup.tsx
 * `scale={[-1,1,1]}`) — this function was the one path that did not, so a mirrored
 * serpentine was judged against a band up to 2.9 m from the one on screen
 * (measured: 25 of its 30 tiles land further than 40 cm from where they are drawn).
 * Every other entry is symmetric about its own origin, so for them this is a no-op.
 *
 * The semantics are `composeTransform`'s to the letter and for the same reason:
 * reflect the local x BEFORE turning, and negate any angle measured inside the
 * reflection, because `R·Rot(ρ)·R⁻¹ = Rot(−ρ)`. Two implementations of one
 * reflection is what would drift.
 */
function placeShape(world: Transform2D, s: Shape): Shape {
  const local = world.mirrored ? { x: -s.x, y: s.y } : { x: s.x, y: s.y }
  const p = rotateVec(local, world.rotation)
  const x = world.position.x + p.x
  const y = world.position.y + p.y
  return s.kind === 'circle'
    ? { kind: 'circle', x, y, r: s.r }
    : rectShape(x, y, s.w, s.h, (world.mirrored ? -s.rot : s.rot) + world.rotation)
}

/**
 * The shapes COLLISION tests an object by, object-local — or `null` when the
 * object's own `outline` is the honest answer, which is every entry but one.
 *
 * `table.serpentine`'s outline is a 422.00 × 426.41 rect around a band whose true
 * area is 4.644 m², 25.8% of it, and whose own centre is 63.13 cm outside the
 * drape. That is fine for snapping and for the venue clamp — a few spare cm cost
 * nothing there — and wrong for a rule about the aisle between two tables: measured
 * off that box, `TABLE_CLEARANCE.rect = 170` refused a ⌀180 round table up to about
 * three metres from the drape. Its footprint's own `parts` already ARE the band, so
 * they are what collision reads.
 *
 * ⚠ THE GATE IS "DOES THE FOOTPRINT CONTAIN AN ARC", NOT "MORE THAN ONE PART".
 * `table.knights-480` draws two rects whose union IS its outline, so tiling it
 * would change nothing and cost a test; and `table.round-large` draws ONE circle
 * carrying `rInner`, so reading that part would make the ⌀380's open centre
 * non-colliding — a rule change nobody asked for, on the table most likely to have
 * something standing in that centre. An `arc` part cannot be expressed as an
 * `Outline` at all, which is exactly why it is the right marker.
 *
 * No new catalog field: an entry that draws its true shape has already said what
 * that shape is.
 */
function collisionShapesOf(parts: FootprintPart[]): Shape[] | null {
  const arcs = parts.filter((p) => p.kind === 'arc')
  if (!arcs.length) return null
  return arcBandTiles(arcs).map((t) => rectShape(t.cx, t.cy, t.w, t.h, t.rot))
}

function shapeAABB(s: Shape): AABB {
  if (s.kind === 'circle') {
    return { minX: s.x - s.r, minY: s.y - s.r, maxX: s.x + s.r, maxY: s.y + s.r }
  }
  // an explicit fold rather than four spreads over four mapped arrays: this runs
  // once per PART now, and the serpentine has thirty of them
  const pts = cornersOf(s)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Separating Axis Theorem on two convex polygons. The axis-aligned
 * `aabbIntersects` is not enough on its own: a table turned 30° reads as
 * overlapping its neighbour long before it touches it.
 */
function polysOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const axis = { x: -(q.y - p.y), y: q.x - p.x }
      let aMin = Infinity
      let aMax = -Infinity
      for (const v of a) {
        const d = v.x * axis.x + v.y * axis.y
        aMin = Math.min(aMin, d)
        aMax = Math.max(aMax, d)
      }
      let bMin = Infinity
      let bMax = -Infinity
      for (const v of b) {
        const d = v.x * axis.x + v.y * axis.y
        bMin = Math.min(bMin, d)
        bMax = Math.max(bMax, d)
      }
      if (aMax < bMin || bMax < aMin) return false
    }
  }
  return true
}

function pointSegDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Exact for segments that do not cross — which is guaranteed here, because
 *  every caller has already ruled overlap out with SAT. */
function segSegDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  return Math.min(
    pointSegDistance(a1, b1, b2),
    pointSegDistance(a2, b1, b2),
    pointSegDistance(b1, a1, a2),
    pointSegDistance(b2, a1, a2),
  )
}

function pointInConvex(p: Vec2, poly: Vec2[]): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function pointPolyDistance(p: Vec2, poly: Vec2[]): number {
  if (pointInConvex(p, poly)) return 0
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, pointSegDistance(p, poly[i], poly[(i + 1) % poly.length]))
  }
  return best
}

/** Gap between two shapes in cm; 0 when they touch or overlap. */
export function shapeGap(a: Shape, b: Shape): number {
  if (a.kind === 'circle' && b.kind === 'circle') {
    return Math.max(0, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r)
  }
  if (a.kind === 'rect' && b.kind === 'rect') {
    const pa = cornersOf(a)
    const pb = cornersOf(b)
    if (polysOverlap(pa, pb)) return 0
    let best = Infinity
    for (let i = 0; i < pa.length; i++) {
      for (let j = 0; j < pb.length; j++) {
        best = Math.min(
          best,
          segSegDistance(pa[i], pa[(i + 1) % pa.length], pb[j], pb[(j + 1) % pb.length]),
        )
      }
    }
    return best
  }
  const circle = (a.kind === 'circle' ? a : b) as Extract<Shape, { kind: 'circle' }>
  const rect = (a.kind === 'rect' ? a : b) as Extract<Shape, { kind: 'rect' }>
  return Math.max(0, pointPolyDistance({ x: circle.x, y: circle.y }, cornersOf(rect)) - circle.r)
}

/**
 * Do any two parts of two subtrees touch?
 *
 * The per-PAIR box reject is the whole point. The subtree-level `aabbIntersects`
 * further down only says the two objects are near each other; inside a near pair
 * every part was then SAT-tested against every other, which for a table with
 * twelve chairs beside another is 169 tests of 121 ns. A box test is 6.4 ns and
 * kills all but a handful of them (both measured on this machine — see the note on
 * `Shape`), and it is exact in the safe direction: a box that misses guarantees
 * the shapes miss, so nothing legal is refused and nothing illegal is admitted.
 */
function partsOverlap(a: Shape[], aBoxes: AABB[], b: Shape[], bBoxes: AABB[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (!aabbIntersects(aBoxes[i], bBoxes[j])) continue
      if (shapesOverlap(a[i], b[j])) return true
    }
  }
  return false
}

/**
 * Lower bound on the gap between two shapes, from their boxes alone. A box
 * contains its shape, so the true gap is never SMALLER than this — which is what
 * makes it safe to skip a pair whose box gap already beats the best found.
 */
function boxGap(a: AABB, b: AABB): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
  const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
  return Math.hypot(dx, dy)
}

/**
 * The narrowest aisle between two objects: a minimum over every pair of their own
 * shapes, chairs excluded.
 *
 * One shape each for every entry but the serpentine, where it is 30 × 1 — hence
 * the box prefilter, which is exact (a box gap is a lower bound, so a pair it
 * skips could not have won) and turns 30 `shapeGap` calls into two or three.
 */
function selfGap(a: Shape[], aBoxes: AABB[], b: Shape[], bBoxes: AABB[]): number {
  let best = Infinity
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (boxGap(aBoxes[i], bBoxes[j]) >= best) continue
      const gap = shapeGap(a[i], b[j])
      if (gap < best) best = gap
      if (best === 0) return 0
    }
  }
  return best
}

function shapesOverlap(a: Shape, b: Shape): boolean {
  if (a.kind === 'circle' && b.kind === 'circle') {
    return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r
  }
  if (a.kind === 'rect' && b.kind === 'rect') return polysOverlap(cornersOf(a), cornersOf(b))
  const circle = (a.kind === 'circle' ? a : b) as Extract<Shape, { kind: 'circle' }>
  const rect = (a.kind === 'rect' ? a : b) as Extract<Shape, { kind: 'rect' }>
  return pointPolyDistance({ x: circle.x, y: circle.y }, cornersOf(rect)) < circle.r
}

// ---------------------------------------------------------------------------
// the obstacle index
// ---------------------------------------------------------------------------

interface Occupant {
  id: Id
  /** subtree box (table + its chairs) — the cheap prefilter */
  box: AABB
  /**
   * The object ITSELF, chairs excluded: what the clearance rule measures between.
   * A LIST since round 4 §15b — one shape for every entry but the serpentine,
   * whose thirty band tiles are what the aisle is measured from rather than the
   * bounding box the outline reports.
   */
  self: Shape[]
  /** `self[i]`'s box — the pair reject for the clearance rule, as `partBoxes` is
   *  for the overlap one */
  selfBoxes: AABB[]
  /** own shapes + every attached chair: what overlap is tested against */
  parts: Shape[]
  /**
   * `parts[i]`'s own box, built here because it is a property of the scene and the
   * candidate side asks about it on every one of the fourteen probes a drag frame
   * makes. It is the second half of the pair reject in `partsOverlap`.
   */
  partBoxes: AABB[]
  isTable: boolean
  clearance: number
}

interface Index {
  scene: SceneState
  occupants: Occupant[]
  /**
   * Attached children by parent id — the sibling rule's only lookup, and it runs
   * on every bisection probe of a table-top drag. Built here because the pass
   * below needs the same grouping anyway.
   */
  children: Map<Id, SceneObject[]>
  zones: RestrictedZone[]
  /** venue contour in plan cm — the pack outline, or the size rectangle */
  contour: Vec2[]
  width: number
  depth: number
}

function outlineOf(obj: SceneObject): Outline {
  return getCatalogEntry(obj.catalogId).footprint(obj.size).outline
}

/** Own flag or category layer. Only top-level objects reach this, so no ancestor walk. */
function isHidden(scene: SceneState, obj: SceneObject): boolean {
  if (obj.flags.visible === false) return true
  return !!scene.settings.layers?.[getCatalogEntry(obj.catalogId).category]?.hidden
}

function unionBox(boxes: AABB[]): AABB {
  return boxes.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }))
}

/**
 * One index per scene VERSION. A drag frame asks several questions of the same
 * scene — is it legal where it is, is it legal where the pointer went, and up to
 * twelve bisection probes — and rebuilding the obstacle list for each of them was
 * the whole measured cost.
 *
 * Keyed on scene identity, which is safe because the store is immer-backed: a
 * mutation always yields a NEW scene object, so a stale entry is unreachable.
 * Callers must therefore never ask about a scene they are midway through
 * mutating — actions.ts runs every gate on `get().scene` before opening the
 * producer, for this reason and because reading 350 objects back through immer's
 * proxies costs more than the geometry does.
 */
const indexCache = new WeakMap<SceneState, Index>()

function indexOf(scene: SceneState): Index {
  const hit = indexCache.get(scene)
  if (hit) return hit
  const built = buildIndex(scene)
  indexCache.set(scene, built)
  return built
}

/**
 * One O(n) pass over the scene. Children are grouped first so that building the
 * 40 subtree boxes of a full hall does not rescan all 520 objects per table —
 * that quadratic version cost more than the SAT it was meant to avoid.
 */
function buildIndex(scene: SceneState): Index {
  const childrenByParent = new Map<Id, SceneObject[]>()
  for (const obj of Object.values(scene.objects)) {
    if (!obj.parentId) continue
    const list = childrenByParent.get(obj.parentId)
    if (list) list.push(obj)
    else childrenByParent.set(obj.parentId, [obj])
  }

  const occupants: Occupant[] = []
  for (const id of scene.objectOrder) {
    const obj = scene.objects[id]
    if (!obj || obj.parentId) continue
    const entry = getCatalogEntry(obj.catalogId)
    // a hung fixture is not on the floor: it never blocked furniture and must not start now
    if (entry.placement === 'ceiling') continue
    if (isHidden(scene, obj)) continue

    const footprint = entry.footprint(obj.size) // allocates — once per object, not twice
    const outline = footprint.outline
    // the object's true shape where it draws one, its outline otherwise
    const local = collisionShapesOf(footprint.parts)
    const self: Shape[] = local
      ? local.map((s) => placeShape(obj.transform, s))
      : [shapeOf(obj.transform, outline)]
    const parts: Shape[] = [...self]
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.attachment?.kind !== 'seat') continue // table-top decor is not a footprint
      parts.push(shapeOf(composeTransform(obj.transform, child.transform), outlineOf(child)))
    }
    const partBoxes = parts.map(shapeAABB)
    occupants.push({
      id,
      box: unionBox(partBoxes),
      self,
      // the self shapes are a PREFIX of parts, so their boxes are already built
      selfBoxes: partBoxes.slice(0, self.length),
      parts,
      partBoxes,
      // defensive: this loop `continue`s on `obj.parentId`, and the two v13
      // arrivals in 'tables' are surface children, so they never reach it. Asked
      // the same way as everywhere else so the rule reads once (catalog/types.ts)
      isTable: isFloorTable(entry),
      clearance: clearanceOf(entry, outline),
    })
  }

  const pack = getVenuePack(scene.venue.venuePackId)
  const { width, depth } = scene.venue.size
  return {
    scene,
    occupants,
    children: childrenByParent,
    zones: pack?.restricted ?? [],
    contour: (pack?.outline ?? [
      [0, 0],
      [width, 0],
      [width, depth],
      [0, depth],
    ]).map(([x, y]) => ({ x, y })),
    width,
    depth,
  }
}

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

/** A zone rectangle as a shape, so the band rule can measure a gap to it. */
function zoneShape(z: RestrictedZone): Shape {
  return rectShape(z.x + z.width / 2, z.y + z.depth / 2, z.width, z.depth, 0)
}

function boxOverlapsZone(box: AABB, z: RestrictedZone): boolean {
  return box.minX < z.x + z.width && box.maxX > z.x && box.minY < z.y + z.depth && box.maxY > z.y
}

/**
 * The reception deck is an INVERTED zone: a whitelisted item is let in and
 * everything else is refused (source doc §41).
 *
 * THE definition of that whitelist, and the reason it is exported: state/actions.ts
 * imports it for the clamping half of the same rule. It used to keep a second copy
 * and a comment asking for the two to be kept in step by hand, which is exactly how
 * the deck came to refuse things this list allowed.
 *
 * `buffet.table` is named outright and is NOT covered by the `tables` line: it is
 * `category: 'bars'` (entries/bars.ts:77), filed with the service furniture rather
 * than the guest tables. Deleting the id as redundant would drop the buffet off the
 * deck — the one piece §41 names explicitly.
 */
export function allowedOnDeck(entry: CatalogEntry): boolean {
  return (
    // "anywhere" includes up here, and saying so HERE is what carries the rule
    // into the clamp: state/actions.ts reads this same function, so a figure
    // dropped on the deck settles onto it instead of being shoved back down.
    entry.placeAnywhere === true ||
    // An entry the zone loop does not apply to (the chuppah decorations) is
    // mechanically forced onto this list: once `check` skips the loop, a "no"
    // here would make `checkPlacement` say yes while `clampToVenue` shoved the
    // piece off the deck — the two halves of one rule disagreeing again, which is
    // the whole reason this function is shared. It is also right on its own: the
    // resort has a second ceremony pad up here, and a ceremony that may have its
    // canopy on the deck but not what dresses it is incoherent.
    entry.ignoresZones === true ||
    entry.zoneKind === 'chuppah' ||
    entry.category === 'seating' ||
    // Guest tables belong up there with the chairs. Round-2 corrections §27, in the
    // user's words: "when I try to place tables or a chuppah in the reception area,
    // even when it is switched on, it will not let me."
    // defensive: `placementViolations` returns early for a surface item long
    // before it reaches the deck branch, so the v13 arrivals never ask this.
    isFloorTable(entry) ||
    entry.id === 'buffet.table'
  )
}

/** Distance from a point to the venue contour, ignoring which side it is on. */
function contourDistance(p: Vec2, contour: Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < contour.length; i++) {
    best = Math.min(best, pointSegDistance(p, contour[i], contour[(i + 1) % contour.length]))
  }
  return best
}

/** Half-diagonal of a shape — its reach in the worst direction. */
function shapeReach(s: Shape): number {
  return s.kind === 'circle' ? s.r : Math.hypot(s.w, s.h) / 2
}

function candidateParts(index: Index, candidate: PlacementCandidate, self: Shape[]): Shape[] {
  const parts = [...self]
  const owned =
    candidate.subtreeOf ?? (typeof candidate.excludeId === 'string' ? candidate.excludeId : null)
  if (!owned) return parts
  // an existing table drags its chairs along: they are part of what must fit
  for (const child of Object.values(index.scene.objects)) {
    if (child.parentId !== owned || child.attachment?.kind !== 'seat') continue
    parts.push(shapeOf(composeTransform(candidate.transform, child.transform), outlineOf(child)))
  }
  return parts
}

/**
 * Does a table-top item stand clear of the OTHER items on the same table?
 *
 * Everything is compared in the PARENT's local frame, which is where a child's
 * stored transform already lives; a world-frame candidate is converted first, and
 * `parentLocal` is what says which of the two arrived. Getting that backwards is
 * silent — a ghost measured against the table's origin instead of its own reports
 * overlaps three metres from where the pointer is.
 *
 * The question asked is always "may it stand where it will END UP", which for a
 * centre-anchored ghost is not the pointer at all — see `centred` below.
 *
 * The four skips are the rule and not an optimisation. Each names a pair that
 * shares a spot BY DESIGN, and dropping any one of them would refuse a placement
 * the app performs itself.
 */
function siblingOverlaps(
  index: Index,
  candidate: PlacementCandidate,
  entry: CatalogEntry,
  excluded: Set<Id>,
): Violation[] {
  const parentId = candidate.parentId
  if (!parentId) return []
  const parent = index.scene.objects[parentId]
  if (!parent) return []
  const parentOutline = outlineOf(parent)

  // Source doc §28/§54: a hand-placed centre-anchored piece does not land where the
  // pointer is. `clampToSurface` pins it to the middle of the table and, on a ring
  // table, into the well (state/actions.ts:448-458). Judging the ghost at the
  // pointer therefore answers a question nobody asked — green over an empty stretch
  // of rim while the piece drops onto an occupied centre, red over a rim decoration
  // while the centre is free. Ask about the spot it will actually take.
  //
  // Ghosts only. An existing child arrives `parentLocal` and is already wherever the
  // clamp left it, which for a DESIGN-laid piece is deliberately NOT the centre —
  // that is the `meta.design` exemption the clamp itself carries, and a candidate
  // carries no `meta` to re-test it by. Forcing those to the origin here would
  // stack every arrangement into one point and call it a self-collision.
  const centred = !candidate.parentLocal && entry.surfaceAnchor === 'center'

  // rotation 0, not the converted one: a hand drop lands square to its table
  // (`addObjectToSurface` writes `rotation: 0`), whatever the ghost was drawn at
  const local = centred
    ? { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 }
    : candidate.parentLocal
      ? candidate.transform
      : relativeTransform(parent.transform, candidate.transform)

  const inHole = centred
    ? holeRadius(parentOutline) > 0
    : (candidate.inHole ??
      (candidate.parentLocal
        ? false
        : pointInHole(candidate.transform.position, parent.transform, parentOutline)))

  const self = shapeOf(local, entry.footprint(candidate.size).outline)
  const out: Violation[] = []
  for (const sibling of index.children.get(parentId) ?? []) {
    if (excluded.has(sibling.id)) continue
    const attachment = sibling.attachment
    // a chair hangs off the table, it is not on the top
    if (attachment?.kind === 'seat') continue
    const other = getCatalogEntry(sibling.catalogId)
    // both laid per cover by laySeatItems at equal pitch: where they touch, the
    // table is over-set rather than misplaced (seatItemLayout.test.ts records it)
    if (entry.placement === 'seat' && other.placement === 'seat') continue
    // the napkin ON its place setting, the arrangement ON the ring table — these
    // are MEANT to coincide, which is the whole meaning of `requiresHost`
    if (entry.requiresHost === sibling.catalogId || other.requiresHost === entry.id) continue
    // the open centre of a ring table is a different storey from its top (§48)
    if ((attachment?.inHole === true) !== inHole) continue
    if (shapesOverlap(self, shapeOf(sibling.transform, outlineOf(sibling)))) {
      out.push({ kind: 'overlapsSibling', id: sibling.id })
    }
  }
  return out
}

/**
 * "Around the pool", "only over the bar": a band `within` cm outside the named
 * zone rectangle.
 *
 * Only the rules whose zone EXISTS in this venue are weighed. A rule naming a
 * zone the pack does not have is not a rule the venue can fail — the same
 * reading `zoneKind` states outright (catalog/types.ts: "Venues without a
 * matching zone (procedural room) place it freely"), and the two mechanisms are
 * the same idea seen from either end. Without it, `index.zones` being empty
 * makes `inBand` false everywhere and vegetation 1 becomes unplaceable in every
 * procedural room and in every future pack without a `saviv` rectangle.
 *
 * "There is no such zone here" and "the zone is here and the item is not in it"
 * are different answers, and only the second is a `wrongZone`. One existing zone
 * is enough to make the rule apply: `known` is what the item is then measured
 * against, and what the refusal names — never a zone this hall does not have.
 *
 * It is a function of its own because BOTH storeys need it and they reach it by
 * different routes — see the ceiling branch in `check`.
 */
function bandViolations(index: Index, entry: CatalogEntry, self: Shape): Violation[] {
  const known = entry.allowedZones?.filter((rule) => index.zones.some((z) => z.kind === rule.kind))
  if (!known?.length) return []
  const inBand = known.some((rule) =>
    index.zones.some((z) => z.kind === rule.kind && shapeGap(self, zoneShape(z)) <= rule.within),
  )
  return inBand ? [] : [{ kind: 'wrongZone', allowed: known.map((r) => r.kind) }]
}

function check(index: Index, candidate: PlacementCandidate): Violation[] {
  // NaN survives every comparison below — `box.minX < -0.01` and the SAT interval
  // tests are all false for it — so a non-finite pose would pass bounds AND
  // overlap and land in the scene. Nothing but an explicit gate stops it.
  const { position } = candidate.transform
  const { width, depth, height } = candidate.size
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    !Number.isFinite(height)
  ) {
    return [{ kind: 'outOfBounds' }]
  }

  const entry = getCatalogEntry(candidate.catalogId)
  const excluded = new Set(
    candidate.excludeId === undefined
      ? []
      : Array.isArray(candidate.excludeId)
        ? candidate.excludeId
        : [candidate.excludeId],
  )

  // one per scene, across every catalog id sharing the tag (source doc §62)
  if (entry.unique) {
    const blocker = Object.values(index.scene.objects).find(
      (o) => !excluded.has(o.id) && getCatalogEntry(o.catalogId).unique === entry.unique,
    )
    if (blocker) return [{ kind: 'duplicate', unique: entry.unique }]
  }

  // Source doc §17: the human figure stands wherever it is put, "including places
  // other elements are not allowed". Everything from here down is a placement
  // rule, and it answers to none of them — no zone, no clearance, not even the
  // venue outline (see the flag's own note in catalog/types.ts).
  //
  // Below the two gates above rather than at the very top, and that is the whole
  // of the ordering decision: a non-finite pose is corruption, not a placement,
  // and `unique` is a statement about how many of a thing the scene may hold,
  // which is not a question about WHERE. Both would still hold for a future
  // entry that carried them alongside this flag.
  if (entry.placeAnywhere) return []

  // A table-top item lives in its parent's local space: the venue rules simply
  // do not apply to it. It answers to two rules of its own — its host must
  // already be on the same table, and it may not stand in another item there.
  if (entry.placement === 'surface' || entry.placement === 'seat') {
    // `autoHost` changes exactly one thing: whether a missing host REFUSES. The
    // drop lays the host in the same gesture (state/actions.ts `addObjectToSurface`),
    // so saying `missingHost` here would paint a red ghost over a placement that is
    // about to succeed. Everything else `requiresHost` does — the sibling skip
    // below, the `stackedOn` link, `surfaceBase` — is untouched by it.
    //
    // ⚠ It lifts the refusal only where the host will REALLY be laid, and that is
    // where the table has an opening to lay it in — the same condition
    // `autoHostFor` applies, and it applies it because laying a ⌀156 table on a
    // solid ⌀180 top would be inventing furniture (BRIEF §1.1). A bare
    // `!entry.autoHost` here would paint the ghost green over every solid table
    // while the drop put a floating urn on the cloth: the ghost and the drop have
    // to read the same rule, which is the whole reason this file exists.
    if (entry.requiresHost && candidate.parentId) {
      const hasHost = (index.children.get(candidate.parentId) ?? []).some(
        (o) => o.catalogId === entry.requiresHost,
      )
      const parent = index.scene.objects[candidate.parentId]
      const willLay = entry.autoHost === true && !!parent && holeRadius(outlineOf(parent)) > 0
      if (!hasHost && !willLay) return [{ kind: 'missingHost', requires: entry.requiresHost }]
    }
    return siblingOverlaps(index, candidate, entry, excluded)
  }

  const footprint = entry.footprint(candidate.size)
  const outline = footprint.outline
  // The SINGULAR coarse shape, kept deliberately: the band rule and `nearWall`
  // both ask a question about the object as a whole ("how far is it from this
  // rectangle", "how far does it reach"), and answering either from thirty tiles
  // would change what those rules mean. Neither is reachable for the serpentine
  // today — no table declares `allowedZones` or `nearWall` — so this preserves
  // their semantics rather than choosing new ones for them.
  const coarse = shapeOf(candidate.transform, outline)
  const local = collisionShapesOf(footprint.parts)
  const self = local ? local.map((s) => placeShape(candidate.transform, s)) : [coarse]
  const parts = candidateParts(index, candidate, self)
  const partBoxes = parts.map(shapeAABB)
  const selfBoxes = partBoxes.slice(0, self.length)
  const box = unionBox(partBoxes)

  const out: Violation[] = []
  if (box.minX < -0.01 || box.minY < -0.01 || box.maxX > index.width + 0.01 || box.maxY > index.depth + 0.01) {
    out.push({ kind: 'outOfBounds' })
  }

  // A hung fixture clears every floor rule below it — pushing chandeliers out of
  // the dance floor is exactly the bug the existing exemption fixed.
  //
  // ⚠ Its OWN siting rule is not a floor rule and does not clear. Source doc §29
  // puts the lamp cluster over the bar and nowhere else, and until this line the
  // exemption swallowed that too: `allowedZones` is read further down, so a
  // ceiling entry that declared one returned here first and was legal over the
  // whole hall, in silence and with nothing failing. The band is the one question
  // asked of both storeys, so it is asked before the exemption rather than after.
  if (entry.placement === 'ceiling') return [...out, ...bandViolations(index, entry, coarse)]

  // A fixed station never answers for the point it was dropped at: clampToVenue
  // snaps it into its home zone from anywhere, so the drop point is not where it
  // ends up and judging it here would paint the ghost red over the whole hall.
  if (entry.zoneKind && index.zones.some((z) => z.kind === entry.zoneKind)) return []

  // Two INVERTED zones live in this loop, and they are the same shape of rule:
  // "no-go for everyone EXCEPT ...". The deck names its exceptions here; a zone
  // named in `entry.allowedZones` names them the other way round, from the entry.
  // Either way the zone stops being a no-go for that one entry and stays a no-go
  // for everyone else — which is why neither can be expressed by dropping the
  // rectangle from the pack.
  //
  // `ignoresZones` lifts THIS LOOP and nothing else (source doc round 4 §7). It is
  // wrapped rather than returned early on purpose: the bounds check above and the
  // band, wall and clearance rules below all still run for such an entry, which is
  // the whole difference between it and `placeAnywhere`.
  if (!entry.ignoresZones) {
    for (const zone of index.zones) {
      if (!boxOverlapsZone(box, zone)) continue
      // An entry that may stand ONLY in this zone obviously may stand IN it. Without
      // this the two halves of `allowedZones` contradict each other: the band rule
      // below demands the item be in its zone, and the line under it would refuse the
      // item for being there. It exempts nothing else — `pool` in particular keeps
      // refusing the vegetation ring's own overlap with the water, because the pool
      // is not the zone the entry named.
      if (zone.kind && entry.allowedZones?.some((rule) => rule.kind === zone.kind)) continue
      if (zone.kind === 'kabalatPanim') {
        if (!allowedOnDeck(entry)) out.push({ kind: 'forbiddenZone', zone: zone.kind })
        continue
      }
      out.push({ kind: 'forbiddenZone', zone: zone.kind ?? zone.label ?? '' })
    }
  }

  // "around the pool", not "in the pool" — see `bandViolations`
  out.push(...bandViolations(index, entry, coarse))

  if (entry.nearWall !== undefined) {
    const centre = { x: candidate.transform.position.x, y: candidate.transform.position.y }
    if (contourDistance(centre, index.contour) - shapeReach(coarse) > entry.nearWall) {
      out.push({ kind: 'nearWall', within: entry.nearWall })
    }
  }

  // defensive, same reason as `allowedOnDeck` above: the surface branch returned
  // ~60 lines up, so a v13 ring centrepiece never reaches the clearance loop
  const isTable = isFloorTable(entry)
  const clearance = clearanceOf(entry, outline)
  for (const other of index.occupants) {
    if (excluded.has(other.id)) continue
    const required = isTable && other.isTable ? Math.max(clearance, other.clearance) : 0
    // cheap AABB reject first — SAT only runs for the handful that survive
    const grown: AABB = {
      minX: box.minX - required,
      minY: box.minY - required,
      maxX: box.maxX + required,
      maxY: box.maxY + required,
    }
    if (!aabbIntersects(grown, other.box)) continue

    if (partsOverlap(parts, partBoxes, other.parts, other.partBoxes)) {
      out.push({ kind: 'collision', withId: other.id })
      continue
    }
    if (required > 0) {
      const gap = selfGap(self, selfBoxes, other.self, other.selfBoxes)
      if (gap < required) out.push({ kind: 'spacing', withId: other.id, actual: gap, required })
    }
  }
  return out
}

/** The one answer. Empty = legal. */
export function checkPlacement(scene: SceneState, candidate: PlacementCandidate): Violation[] {
  return check(indexOf(scene), candidate)
}

/**
 * The furthest legal point along `from → candidate`, so a blocked drag STICKS to
 * the boundary instead of freezing where the gesture began. `null` when even
 * `from` is illegal — the caller then leaves the object where it is.
 *
 * ponytail: bisection over the whole predicate rather than per-obstacle contact
 * solving. 12 halvings put it within |delta|/4096 of the true contact point,
 * which is sub-millimetre for any real drag step, and it stays correct when a
 * new rule is added.
 */
export function slideToLegal(
  scene: SceneState,
  candidate: PlacementCandidate,
  from: Vec2,
): Vec2 | null {
  const index = indexOf(scene)
  const to = candidate.transform.position
  const at = (t: number): PlacementCandidate => ({
    ...candidate,
    transform: {
      ...candidate.transform,
      position: { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
    },
  })
  if (!check(index, at(1)).length) return { ...to }
  if (check(index, at(0)).length) return null
  let lo = 0
  let hi = 1
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    if (check(index, at(mid)).length) hi = mid
    else lo = mid
  }
  return at(lo).transform.position
}
