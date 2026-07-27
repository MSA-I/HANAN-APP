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
import type { CatalogEntry, Outline } from '../catalog/types'
import type { Id, SceneObject, SceneState, Size3D, Transform2D, Vec2 } from '../model/types'
import { composeTransform, rotateVec } from '../space'
import { getVenuePack, type RestrictedZone } from '../venuePacks'
import { aabbIntersects, type AABB } from './bounds'

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

function clearanceOf(outline: Outline): number {
  return outline.kind === 'rect' ? TABLE_CLEARANCE.rect : TABLE_CLEARANCE.circle
}

// ---------------------------------------------------------------------------
// geometry — rotated rectangles and discs
// ---------------------------------------------------------------------------

type Shape =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rot: number }

function shapeOf(world: Transform2D, outline: Outline): Shape {
  const { x, y } = world.position
  return outline.kind === 'circle'
    ? { kind: 'circle', x, y, r: outline.r }
    : { kind: 'rect', x, y, w: outline.w, h: outline.h, rot: world.rotation }
}

/** World corners, clockwise. Rotation goes through space.ts — never a raw sin/cos here. */
function cornersOf(s: Extract<Shape, { kind: 'rect' }>): Vec2[] {
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

function shapeAABB(s: Shape): AABB {
  if (s.kind === 'circle') {
    return { minX: s.x - s.r, minY: s.y - s.r, maxX: s.x + s.r, maxY: s.y + s.r }
  }
  const pts = cornersOf(s)
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
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
  /** the object's OWN outline: what the clearance rule measures between */
  self: Shape
  /** own outline + every attached chair: what overlap is tested against */
  parts: Shape[]
  isTable: boolean
  clearance: number
}

interface Index {
  scene: SceneState
  occupants: Occupant[]
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

    const outline = outlineOf(obj) // footprint() allocates — once per object, not twice
    const self = shapeOf(obj.transform, outline)
    const parts: Shape[] = [self]
    for (const child of childrenByParent.get(id) ?? []) {
      if (child.attachment?.kind !== 'seat') continue // table-top decor is not a footprint
      parts.push(shapeOf(composeTransform(obj.transform, child.transform), outlineOf(child)))
    }
    occupants.push({
      id,
      box: unionBox(parts.map(shapeAABB)),
      self,
      parts,
      isTable: entry.category === 'tables',
      clearance: clearanceOf(outline),
    })
  }

  const pack = getVenuePack(scene.venue.venuePackId)
  const { width, depth } = scene.venue.size
  return {
    scene,
    occupants,
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
  return { kind: 'rect', x: z.x + z.width / 2, y: z.y + z.depth / 2, w: z.width, h: z.depth, rot: 0 }
}

function boxOverlapsZone(box: AABB, z: RestrictedZone): boolean {
  return box.minX < z.x + z.width && box.maxX > z.x && box.minY < z.y + z.depth && box.maxY > z.y
}

/**
 * The reception deck is an INVERTED zone: a whitelisted item is let in and
 * everything else is refused. Kept in step with `allowedInKabalatPanim` in
 * state/actions.ts, which does the clamping half of the same rule.
 */
function allowedOnDeck(entry: CatalogEntry): boolean {
  return entry.zoneKind === 'chuppah' || entry.category === 'seating' || entry.id === 'buffet.table'
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

function candidateParts(index: Index, candidate: PlacementCandidate, self: Shape): Shape[] {
  const parts = [self]
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

function check(index: Index, candidate: PlacementCandidate): Violation[] {
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

  // A table-top item lives in its parent's local space: the venue rules simply
  // do not apply to it. Its own rule is that its host must already be there.
  if (entry.placement === 'surface' || entry.placement === 'seat') {
    if (!entry.requiresHost || !candidate.parentId) return []
    const hasHost = Object.values(index.scene.objects).some(
      (o) => o.parentId === candidate.parentId && o.catalogId === entry.requiresHost,
    )
    return hasHost ? [] : [{ kind: 'missingHost', requires: entry.requiresHost }]
  }

  const outline = entry.footprint(candidate.size).outline
  const self = shapeOf(candidate.transform, outline)
  const parts = candidateParts(index, candidate, self)
  const box = unionBox(parts.map(shapeAABB))

  const out: Violation[] = []
  if (box.minX < -0.01 || box.minY < -0.01 || box.maxX > index.width + 0.01 || box.maxY > index.depth + 0.01) {
    out.push({ kind: 'outOfBounds' })
  }

  // A hung fixture clears every floor rule below it — pushing chandeliers out of
  // the dance floor is exactly the bug the existing exemption fixed.
  if (entry.placement === 'ceiling') return out

  // A fixed station never answers for the point it was dropped at: clampToVenue
  // snaps it into its home zone from anywhere, so the drop point is not where it
  // ends up and judging it here would paint the ghost red over the whole hall.
  if (entry.zoneKind && index.zones.some((z) => z.kind === entry.zoneKind)) return []

  for (const zone of index.zones) {
    if (!boxOverlapsZone(box, zone)) continue
    if (zone.kind === 'kabalatPanim') {
      if (!allowedOnDeck(entry)) out.push({ kind: 'forbiddenZone', zone: zone.kind })
      continue
    }
    out.push({ kind: 'forbiddenZone', zone: zone.kind ?? zone.label ?? '' })
  }

  // "around the pool", not "in the pool": a band `within` cm outside the zone
  if (entry.allowedZones?.length) {
    const inBand = entry.allowedZones.some((rule) =>
      index.zones.some((z) => z.kind === rule.kind && shapeGap(self, zoneShape(z)) <= rule.within),
    )
    if (!inBand) out.push({ kind: 'wrongZone', allowed: entry.allowedZones.map((r) => r.kind) })
  }

  if (entry.nearWall !== undefined) {
    const centre = { x: candidate.transform.position.x, y: candidate.transform.position.y }
    if (contourDistance(centre, index.contour) - shapeReach(self) > entry.nearWall) {
      out.push({ kind: 'nearWall', within: entry.nearWall })
    }
  }

  const isTable = entry.category === 'tables'
  const clearance = clearanceOf(outline)
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

    if (parts.some((p) => other.parts.some((q) => shapesOverlap(p, q)))) {
      out.push({ kind: 'collision', withId: other.id })
      continue
    }
    if (required > 0) {
      const gap = shapeGap(self, other.self)
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
