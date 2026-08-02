/**
 * Which reference images ride along with a capture, and in what order.
 *
 * Three jobs (PLAN-08 §46, §47 and round 2's §26):
 *  1. decide what is actually IN the frame, so an item the camera cannot see
 *     does not spend one of the scarce reference slots;
 *  2. collapse the survivors to one reference per PRODUCT — forty round tables
 *     are one reference and the number forty goes into the prose instead;
 *  3. separate the hall's OWN fittings from the event's design, so the bar and
 *     the planters are not the first pictures to be cut. See `isFixedElement`.
 *
 * The slot arithmetic itself lives in fragments.ts and only there.
 */
import { Box3, Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { getCatalogEntry, hasCatalogEntry } from '../catalog/registry'
import type { CatalogEntry, Category } from '../catalog/types'
import { outlineAABB } from '../layout/bounds'
import type { Id, SceneObject, SceneState, Transform2D } from '../model/types'
import { cmToM, composeTransform } from '../space'
import type { SealedCamera } from '../venuePacks'
import { isVisibleEnough } from './coverage'
import { colorPhrase, designRefBudget, MAX_FIXED_REFS } from './fragments'

/** The frame the capture is taken at (Scene3D `doCapture`), so the frustum matches it. */
export const CAPTURE_SIZE = { width: 1536, height: 1024 }

/**
 * Every role a reference can carry, IN LIST ORDER — `selectRefs` emits them in
 * exactly this sequence and `refPhrase` (compose.ts) relies on each role being
 * contiguous, so this array is the order as much as it is the set.
 *
 * A runtime array rather than a bare union because `tools/capture-plugin.ts`
 * keeps its own copy of this list (`REF_ROLES`) and downgrades anything missing
 * from it to `design` SILENTLY — wrong role in manifest.json, wrong file name on
 * disk, no error. Exporting the names is what lets a test hold the two together.
 */
export const REF_ROLE_NAMES = ['materials', 'background', 'floor', 'fixed', 'design'] as const

export type RefRole = (typeof REF_ROLE_NAMES)[number]

export interface ExportRef {
  /** `<root>/<rest>` — resolved and bounds-checked server side, see refPaths.ts */
  path: string
  role: RefRole
  caption: string
}

/**
 * §46: the hall photo is the MATERIAL reference — floors, ceilings, metalwork —
 * and nothing else. It is first in the list and always present, including on the
 * two reception-deck angles, where it is the only cue to the resort's finishes
 * (the deck itself is modelled as bare slab).
 *
 * There are TWO of them and exactly one is sent, chosen by the angle: an
 * eye-level photograph cannot show a floor an overhead frame is mostly made of.
 * See `materialRefFor`. This is a SWAP, not an addition — the image budget in
 * fragments.ts is unchanged.
 */
export const HALL_MATERIAL_REF: ExportRef = {
  path: 'HANAN-APP-DOCS/טסטים/זווית מקורית.png',
  role: 'materials',
  caption:
    'Reference for building materials only: floors, ceilings, metalwork, walls. ' +
    'Do not copy furniture or decor from this image.',
}

/**
 * The same reference for an overhead angle: shot from above, so the floor reads.
 *
 * ⚠ PLAN-05 C1 rewrote this caption because it described the wrong picture. It
 * used to say "the stone floor and its geometric inlay … take the floor pattern
 * and its proportions from this image", and this photograph is the single best
 * proof that there IS no inlay: it is the top-down view, the one an inlay could
 * not hide from, and it shows nothing but a plain orthogonal grid of metre-square
 * veined marble. A caption asking for a pattern its own image does not contain is
 * a contradictory input in the same package as the corrected prose — which is
 * precisely the failure this item exists to remove.
 */
export const HALL_MATERIAL_REF_ELEVATED: ExportRef = {
  path: 'HANAN-APP-DOCS/טסטים/מבט על מקורית.png',
  role: 'materials',
  caption:
    'Reference for building materials only, photographed from above: the stone floor, plus ' +
    'ceilings, metalwork and walls. Take the floor from this image — plain square tiles in a ' +
    'simple orthogonal grid, thin joints, cloudy veining, and no inlaid pattern of any kind — ' +
    'along with its tile proportions and the way the daylight sits on it. Do not copy furniture ' +
    'or decor from it.',
}

/**
 * How far the eye must sit ABOVE what it is aimed at before an angle counts as
 * overhead. Measured against the resort pack's own seven cameras (metres of drop
 * from `position[1]` to `target[1]`):
 *
 *   s1 0.07 · s2 0.19 · s3 0.20 · k1 0.01 · k2 0.46   ← level, or as good as
 *   s5 2.63 · s4 6.19                                 ← the two labelled "(מוגבה)"
 *
 * Anything between 0.46 and 2.63 separates them, so 1 metre sits in open ground
 * rather than on a boundary. Deliberately GEOMETRIC and not a list of ids or a
 * match on the Hebrew label: a camera that is moved changes bucket by itself, and
 * a new overhead angle needs no edit here. The two deck cameras are the reason a
 * plain height test would not do — they stand 6.3 m up, on a terrace, looking
 * level across it.
 */
const ELEVATED_EYE_DROP_M = 1

/** True when this angle looks DOWN at the room rather than across it. */
export function isElevatedAngle(camera: SealedCamera | null): boolean {
  return !!camera && camera.position[1] - camera.target[1] >= ELEVATED_EYE_DROP_M
}

/**
 * The one materials photograph this angle should carry.
 *
 * An overhead frame is mostly floor, and the eye-level photograph shows the floor
 * at a grazing angle where the tile grid foreshortens to almost nothing; the
 * top-down one shows the grid square and the veining flat. With no sealed camera
 * there is no angle to judge, so the eye-level shot stands as the default.
 *
 * (This comment used to say "the chevron inlay". There is no chevron inlay —
 * see HALL_MATERIAL_REF_ELEVATED above and PLAN-05 C1.)
 */
export function materialRefFor(camera: SealedCamera | null): ExportRef {
  return isElevatedAngle(camera) ? HALL_MATERIAL_REF_ELEVATED : HALL_MATERIAL_REF
}

/**
 * PLAN-05 C1, the user's "צריך לצרף גם את התמונה של הריצוף".
 *
 * The two materials shots are photographs of a ROOM: they give ceiling, metal,
 * walls and the floor at a distance. This is the stone itself — the tile module,
 * the joint line and the veining — which is the one thing a room shot cannot
 * carry and the one thing the complaint was about. It is an ADDITION, not a
 * swap; see `floorRefFor` for the single angle class that does not get it.
 *
 * ⚠ PROVENANCE, and it is not what the file name suggests. This is a material
 * -INTENT swatch generated in ChatGPT on 2026-07-21, not a photograph of the
 * floor that is in the hall. It earns the slot because it agrees with both real
 * reference photographs — pale warm grey-beige stone, plain orthogonal grid of
 * roughly metre-square tiles, thin slightly darker joints, cloudy veining that
 * differs tile to tile, and no band, border or inlay anywhere. When the real
 * floor is finally photographed it REPLACES this file at the same path, and
 * nothing in this repository changes. That is why the path is a plain one under
 * a root that is already open (tools/capture-plugin.ts REF_ROOTS) rather than
 * the swatch's own generated name, which carries spaces and commas.
 *
 * ⚠ And it is lit FLAT. The swatch has no highlights in it at all, so its
 * caption must not ask for the polish — the materials photograph is where the
 * sheen actually is, and asking two references for the same property when only
 * one has it is the contradictory-input failure this whole item exists to fix.
 *
 * Missing from disk degrades gracefully: capture-plugin.ts:205-207 warns and
 * writes the package without it.
 */
export const HALL_FLOOR_REF: ExportRef = {
  path: 'HANAN-APP-DOCS/טסטים/ריצוף.png',
  role: 'floor',
  caption:
    'Close-up material swatch for the FLOOR ONLY: the exact stone, its colour, its soft cloudy ' +
    'veining, its square tile module and its thin joint lines. The floor throughout the render is ' +
    'this stone, laid in this plain orthogonal grid, at this tile size. This swatch is lit flat ' +
    'and deliberately shows no reflections — take the floor\'s polish and its broad soft ' +
    'highlights from the materials photograph instead. Take nothing else from this image.',
}

/**
 * The floor close-up, but only for an angle that stands on THAT floor.
 *
 * Geometric and data-driven rather than a list of ids, in the same spirit as
 * `ELEVATED_EYE_DROP_M` above: `camera.zone` (venuePacks.ts) is the working area
 * an angle belongs to, and an angle with a zone stands on a surface of its own —
 * the raised reception deck — whose floor is bare slab. Both deck templates
 * describe a plain unpatterned deck and both explicitly REFUSE the hall's stone
 * (templates.ts, k1/k2 `negative`), so sending them this swatch would spend a
 * slot to contradict the prompt it travels with.
 *
 * With no sealed camera there is nothing to judge, and an extra reference is the
 * better way to be wrong here than a missing one — the same rule objectsInFrame
 * is written to.
 */
export function floorRefFor(camera: SealedCamera | null): ExportRef | null {
  return camera && camera.zone ? null : HALL_FLOOR_REF
}

/**
 * §23: the second fixed reference — a photograph of the land the venue actually
 * stands on, so the view through the glazing is the real one instead of whatever
 * the model invents behind a window.
 *
 * It lives outside HANAN-APP-DOCS, in the site's own photography, which is why
 * tools/capture-plugin.ts carries a third entry in REF_ROOTS. `resolveRefPath`
 * is unchanged and still the trust boundary: adding a root is the only sanctioned
 * way to widen what the server will read.
 */
export const BACKGROUND_REF: ExportRef = {
  path: 'GAMOS-DOCS/תמונות לאנימציית האתר/ריזורט 1/1.png',
  role: 'background',
  caption:
    'The REAL landscape this building stands in — the view seen through the glazing and beyond ' +
    'the parapet. Take the horizon, the terrain, the vegetation and the sky from this image. ' +
    'Do not copy any building, structure or furniture from it.',
}

/**
 * Which product gets a reference slot when more kinds of thing are in frame than
 * there are slots, most important first (PLAN-08 A2 §2). Applied WITHIN each of
 * the two budgets — fixed elements and design items are ranked separately.
 *
 * The first five tiers are the plan's; the last four are its unavoidable
 * extension — the plan named only the categories a wedding is judged on, and a
 * scene can also hold a bar, a DJ booth, a bridal settee, place settings and
 * plants. Within a tier, the product there is MORE of wins, on the grounds that
 * it occupies more of the frame.
 */
const CATEGORY_PRIORITY: Category[] = [
  'chuppah',
  'lighting',
  'tableDecor',
  'tables',
  'seating',
  'bridalChair',
  'bars',
  'tableware',
  'decor',
]

/**
 * A fitting of the HALL rather than of the event (§26): the bar, the DJ booth,
 * the planters — and anything PLAN-01 baked in as a frozen fixture.
 *
 * NOT `entry.zoneKind`: the chuppah carries it and a chuppah is event furniture,
 * while `plant.potted-2` carries no siting rule at all (the round-2 corrections
 * removed it) and is plainly a hall planter. The two categories the user named
 * plus the baked fixtures ARE the set.
 */
function isFixedElement(obj: SceneObject, entry: CatalogEntry): boolean {
  return obj.flags.frozen === true || entry.category === 'bars' || entry.category === 'decor'
}

export interface DesignGroup {
  catalogId: string
  entry: CatalogEntry
  count: number
  /** the colour override, already worded — null when the item is its default */
  color: string | null
  caption: string
  /**
   * §26: this product is a fitting of the hall, so it is illustrated BEFORE the
   * design cut rather than last. True when ANY object in the group is one — a
   * baked fixture and a hand-placed copy of the same bar are one picture.
   */
  fixed: boolean
  /**
   * PLAN-05 C3: the share of the frame this product's members occupy between
   * them, summed. `undefined` when nothing was measured, which is a different
   * statement from 0 ("measured, and invisible") — `byPriority` reads it.
   */
  coverage?: number
}

/** World transform of any object; attached children compose with their parent. */
function worldOf(scene: SceneState, obj: SceneObject): Transform2D {
  if (!obj.parentId) return obj.transform
  const parent = scene.objects[obj.parentId]
  return parent ? composeTransform(parent.transform, obj.transform) : obj.transform
}

/**
 * Own visibility flag, own category layer, and every ancestor's — the same cut
 * the 3D view makes, so a hidden object is absent from the capture AND from the
 * references.
 *
 * Deliberately re-derived here rather than imported from state/selectors: core
 * does not depend on state, and this keeps compose() a pure function of a scene.
 */
function isVisible(scene: SceneState, id: Id): boolean {
  let current: SceneObject | undefined = scene.objects[id]
  while (current) {
    if (current.flags.visible === false) return false
    if (hasCatalogEntry(current.catalogId)) {
      const category = getCatalogEntry(current.catalogId).category
      if (scene.settings.layers?.[category]?.hidden) return false
    }
    current = current.parentId ? scene.objects[current.parentId] : undefined
  }
  return true
}

/** Plan-space footprint + height → the three-space box the camera would see. */
function boxOf(scene: SceneState, obj: SceneObject, entry: CatalogEntry): Box3 {
  const world = worldOf(scene, obj)
  const aabb = outlineAABB(world, entry.footprint(obj.size).outline)
  const base = cmToM(world.elevation)
  return new Box3(
    new Vector3(cmToM(aabb.minX), base, cmToM(aabb.minY)),
    new Vector3(cmToM(aabb.maxX), base + cmToM(obj.size.height), cmToM(aabb.maxY)),
  )
}

/**
 * The view frustum of a sealed angle, built from the pack's own numbers so it
 * matches what the capture will show. Pure maths — no renderer and no canvas, so
 * it runs under vitest's node environment.
 */
export function frustumOf(camera: SealedCamera, aspect = CAPTURE_SIZE.width / CAPTURE_SIZE.height): Frustum {
  const cam = new PerspectiveCamera(camera.fov, aspect, 0.1, 4000)
  cam.position.set(...camera.position)
  cam.up.set(0, 1, 0)
  cam.lookAt(new Vector3(...camera.target))
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  )
}

/**
 * PLAN-05 C3 — what share of the rendered frame each object actually occupies,
 * 0..1, keyed by object id.
 *
 * Produced in `viewer3d/visibilityOracle.ts` (it needs a renderer) and passed
 * INWARDS as a plain parameter. Deliberately not a field on the scene and not a
 * module singleton: coverage is the measurement of one frame from one angle, and
 * storing it on the model would pollute a saved project with a number that is
 * true of a single picture.
 *
 * ABSENT means "nobody measured", and then the frustum is the whole answer —
 * which is what keeps every test written before C3 passing untouched.
 */
export type Coverage = Record<Id, number>

/**
 * Visible objects whose box intersects the frustum (gate 3: a thing that is not
 * in the picture does not need a reference) AND that the measurement, if there
 * is one, found something of in the frame.
 *
 * Intersection, not containment: a table half out of frame is still half in it.
 * The test is on the axis-aligned box, so it is generous at the edges — which is
 * the right way to be wrong here, since the cost of one extra reference is one
 * slot and the cost of a missing one is an item the model renders blank.
 *
 * The frustum stays FIRST and stays the fallback. It is cheap, it is pure maths,
 * and it is the only answer available under vitest; the coverage test is a
 * second gate behind it, never a replacement. An object the frustum rejects is
 * never measured in the first place.
 *
 * ⚠ An id MISSING from a coverage map keeps the frustum's answer — see
 * `isVisibleEnough`. The oracle records an explicit 0 for everything it probed,
 * so absence means "could not be probed", and chairs are always in that state.
 */
export function objectsInFrame(
  scene: SceneState,
  camera: SealedCamera | null,
  coverage?: Coverage,
): SceneObject[] {
  const frustum = camera ? frustumOf(camera) : null
  return Object.values(scene.objects).filter((obj) => {
    if (!hasCatalogEntry(obj.catalogId) || !isVisible(scene, obj.id)) return false
    if (!frustum) return true // no sealed camera → nothing to cull against, gate 3's fallback
    if (!frustum.intersectsBox(boxOf(scene, obj, getCatalogEntry(obj.catalogId)))) return false
    if (!coverage) return true // nobody measured → the frustum IS the answer
    return isVisibleEnough(coverage[obj.id])
  })
}

/**
 * One group per product-and-colour: the same table in ivory and in gold are two
 * references, because they are two different things to look at.
 */
/**
 * ⚠ THE VISIBILITY CUT IS MADE PER GROUP, NOT PER OBJECT, and that is the whole
 * of the difference between this working and this being a menace.
 *
 * The oracle hides ONE object and measures what changed, so a table standing
 * directly behind another table of the same kind measures ~0 — not because it is
 * out of the picture but because its twin is drawn over it. Cutting per object
 * would turn "forty round tables" into "three round tables" in the prose of a
 * frame that plainly shows forty, which is a worse lie than the one C3 exists to
 * remove.
 *
 * So: a group SURVIVES if any one of its members is visible, and its `count`
 * stays what the room holds. The reference picture is per product, and one
 * visible member is all it takes for that picture to be worth sending.
 */
export function groupForRefs(
  scene: SceneState,
  camera: SealedCamera | null,
  coverage?: Coverage,
): DesignGroup[] {
  const inFrame = objectsInFrame(scene, camera)
  const visible = coverage
    ? new Set(objectsInFrame(scene, camera, coverage).map((o) => o.id))
    : null

  const groups = new Map<string, DesignGroup & { seen?: boolean }>()
  for (const obj of inFrame) {
    const entry = getCatalogEntry(obj.catalogId)
    const color = colorPhrase(entry, obj.appearance)
    const key = `${obj.catalogId}${color ?? ''}`
    const share = coverage?.[obj.id] ?? 0
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.fixed ||= isFixedElement(obj, entry)
      if (coverage) {
        existing.coverage = (existing.coverage ?? 0) + share
        existing.seen ||= visible!.has(obj.id)
      }
      continue
    }
    groups.set(key, {
      catalogId: obj.catalogId,
      entry,
      count: 1,
      color,
      caption: `${entry.promptFragment ?? entry.id}${color ?? ''}`,
      fixed: isFixedElement(obj, entry),
      coverage: coverage ? share : undefined,
      seen: coverage ? visible!.has(obj.id) : undefined,
    })
  }

  return [...groups.values()]
    .filter((g) => !coverage || g.seen)
    .map(({ seen: _seen, ...group }) => group)
    .sort(byPriority)
}

/**
 * Tier first, always. Inside a tier the tie-break is how much of the FRAME the
 * product occupies when that has been measured, and how many of it there are
 * when it has not.
 *
 * Forty chairs tucked under tables behind the bar are one small smudge; one
 * chuppah is a third of the picture. "How much of the frame" answers "is this
 * worth one of sixteen slots" better than "how many are there" does — but only
 * when somebody actually looked, so the count remains the answer under vitest
 * and on any angle that was not measured.
 */
function byPriority(a: DesignGroup, b: DesignGroup): number {
  const tier =
    CATEGORY_PRIORITY.indexOf(a.entry.category) - CATEGORY_PRIORITY.indexOf(b.entry.category)
  if (tier !== 0) return tier
  if (a.coverage !== undefined && b.coverage !== undefined && a.coverage !== b.coverage) {
    return b.coverage - a.coverage
  }
  if (a.count !== b.count) return b.count - a.count
  return a.catalogId.localeCompare(b.catalogId)
}

export interface RefSelection {
  refs: ExportRef[]
  /** every group in frame, in priority order — the prose lists all of them */
  groups: DesignGroup[]
  warnings: string[]
}

/**
 * PLAN-05 C3's MANDATORY safety floor.
 *
 * The oracle renders the scene N+1 times and counts pixels. Anything that can go
 * wrong with that — a lost context, a readback of a cleared buffer, a scene
 * whose objects were never tagged, a measurement taken at the wrong moment —
 * shows up as "every product covers zero", and the honest reading of that is
 * "the hall is empty". It is not, and a dressed hall exporting with three
 * references and no TABLES line is a far worse failure than one surplus picture:
 * the surplus costs a slot, this costs the whole package silently.
 *
 * So: if the measurement empties a list the frustum had filled, the measurement
 * is what gets thrown away, and the warning says so out loud. Only that shape is
 * treated as a fault. A measurement that thins the list is the feature working,
 * and a frustum list that was empty to begin with is simply an empty room.
 */
function measuredGroups(
  scene: SceneState,
  camera: SealedCamera | null,
  coverage: Coverage | undefined,
): { groups: DesignGroup[]; warnings: string[] } {
  if (!coverage) return { groups: groupForRefs(scene, camera), warnings: [] }

  const measured = groupForRefs(scene, camera, coverage)
  if (measured.length) return { groups: measured, warnings: [] }

  const unmeasured = groupForRefs(scene, camera)
  if (!unmeasured.length) return { groups: unmeasured, warnings: [] } // the room really is empty
  return {
    groups: unmeasured,
    warnings: [
      `Visibility measurement found none of the ${unmeasured.length} products the frame contains, ` +
        'so it was discarded and every item in frame is described. The references may include ' +
        'things the camera cannot actually see.',
    ],
  }
}

/**
 * `thumbnail` is a web path ("/thumbs/x.webp"); the file is under public/. It is
 * the catalog's own product-shot mapping, so it cannot drift from the entry.
 *
 * ⚠ What ships IS the 512px thumbnail. An earlier comment here claimed the dev
 * server upgrades it to the full-resolution original in HANAN-APP-DOCS/GPT —
 * it does not: tools/capture-plugin.ts `copyFileSync`s the webp as it stands.
 * A real export measured the two fixed-role references at 8.8 MB and 10.4 MB
 * and every product shot at 4–22 KB, which is the whole of the evidence. See
 * handoff/FOUND-08.md.
 */
function productRef(group: DesignGroup, role: 'fixed' | 'design'): ExportRef {
  return { path: `public${group.entry.thumbnail}`, role, caption: group.caption }
}

/**
 * The fixed shots — hall materials, the site's landscape, and on a hall angle
 * the floor close-up — then the hall's own fittings, then the event's design
 * items, each in priority order.
 *
 * The materials shot is whichever of the two suits this angle (`materialRefFor`);
 * it is one slot either way, so the sixteen-image budget is untouched.
 *
 * The floor swatch is THIRD, after the background and before the fittings
 * (PLAN-05 C1 §3.2). Third keeps every index the existing tests pin (`refs[0]`
 * materials, `refs[1]` background), keeps each role contiguous the way
 * `refPhrase` requires, and reads in the order the prompt argues in: the
 * materials, then the place, then the ground, then the structure, then the
 * event. It costs one design slot on a hall angle and none on the deck, where
 * `designRefBudget` hands the unused always-on slot straight back.
 *
 * §26's defect was one of PRIORITY, not of framing: `objectsInFrame` already
 * honours "as long as they appear in the same view", but CATEGORY_PRIORITY ranks
 * `bars` seventh and `decor` last, so the bar, the DJ booth and the planters
 * were the first references to be cut — the three things that make a render
 * recognisable as THIS building. They now get their own budget ahead of the cut.
 *
 * BOTH cuts are named in `warnings`: silently dropping a reference would leave
 * the prompt asking for an item the model has never been shown.
 *
 * `groups` is returned uncut on purpose — an item that lost its picture is still
 * in the room and still belongs in the written description.
 */
export function selectRefs(
  scene: SceneState,
  camera: SealedCamera | null,
  coverage?: Coverage,
): RefSelection {
  const { groups, warnings: measurementWarnings } = measuredGroups(scene, camera, coverage)
  const fixedGroups = groups.filter((g) => g.fixed)
  const designGroups = groups.filter((g) => !g.fixed)
  const warnings: string[] = [...measurementWarnings]

  const keptFixed = fixedGroups.slice(0, MAX_FIXED_REFS)
  const cutFixed = fixedGroups.slice(MAX_FIXED_REFS)
  const fixedRefs = keptFixed.filter((g) => g.entry.thumbnail).map((g) => productRef(g, 'fixed'))

  // materials + background, and the floor swatch on a hall angle but not on the deck
  const floorRef = floorRefFor(camera)
  const alwaysOn = floorRef ? 3 : 2

  // every always-on and fixed slot NOBODY took goes back to the design list
  const budget = designRefBudget(fixedRefs.length, alwaysOn)
  const keptDesign = designGroups.slice(0, budget)
  const cutDesign = designGroups.slice(budget)
  const designRefs = keptDesign.filter((g) => g.entry.thumbnail).map((g) => productRef(g, 'design'))

  if (cutFixed.length) {
    warnings.push(
      `${fixedGroups.length} fixed hall elements in frame, ${MAX_FIXED_REFS} references included. ` +
        `Without a reference image: ${cutFixed.map((g) => g.catalogId).join(', ')}.`,
    )
  }
  if (cutDesign.length) {
    warnings.push(
      `${designGroups.length} design items in frame, ${budget} references included. ` +
        `Without a reference image: ${cutDesign.map((g) => g.catalogId).join(', ')}.`,
    )
  }
  const missingArt = [...keptFixed, ...keptDesign]
    .filter((g) => !g.entry.thumbnail)
    .map((g) => g.catalogId)
  if (missingArt.length) {
    warnings.push(`No product shot on file for: ${missingArt.join(', ')}.`)
  }

  return {
    refs: [
      materialRefFor(camera),
      BACKGROUND_REF,
      ...(floorRef ? [floorRef] : []),
      ...fixedRefs,
      ...designRefs,
    ],
    groups,
    warnings,
  }
}
