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
import { colorPhrase, designRefBudget, MAX_FIXED_REFS } from './fragments'

/** The frame the capture is taken at (Scene3D `doCapture`), so the frustum matches it. */
export const CAPTURE_SIZE = { width: 1536, height: 1024 }

export type RefRole = 'materials' | 'background' | 'fixed' | 'design'

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
 */
export const HALL_MATERIAL_REF: ExportRef = {
  path: 'HANAN-APP-DOCS/טסטים/זווית מקורית.png',
  role: 'materials',
  caption:
    'Reference for building materials only: floors, ceilings, metalwork, walls. ' +
    'Do not copy furniture or decor from this image.',
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
 * Visible objects whose box intersects the frustum (gate 3: a thing that is not
 * in the picture does not need a reference).
 *
 * Intersection, not containment: a table half out of frame is still half in it.
 * The test is on the axis-aligned box, so it is generous at the edges — which is
 * the right way to be wrong here, since the cost of one extra reference is one
 * slot and the cost of a missing one is an item the model renders blank.
 */
export function objectsInFrame(scene: SceneState, camera: SealedCamera | null): SceneObject[] {
  const frustum = camera ? frustumOf(camera) : null
  return Object.values(scene.objects).filter((obj) => {
    if (!hasCatalogEntry(obj.catalogId) || !isVisible(scene, obj.id)) return false
    if (!frustum) return true // no sealed camera → nothing to cull against, gate 3's fallback
    return frustum.intersectsBox(boxOf(scene, obj, getCatalogEntry(obj.catalogId)))
  })
}

/**
 * One group per product-and-colour: the same table in ivory and in gold are two
 * references, because they are two different things to look at.
 */
export function groupForRefs(scene: SceneState, camera: SealedCamera | null): DesignGroup[] {
  const groups = new Map<string, DesignGroup>()
  for (const obj of objectsInFrame(scene, camera)) {
    const entry = getCatalogEntry(obj.catalogId)
    const color = colorPhrase(entry, obj.appearance)
    const key = `${obj.catalogId}${color ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      existing.fixed ||= isFixedElement(obj, entry)
      continue
    }
    groups.set(key, {
      catalogId: obj.catalogId,
      entry,
      count: 1,
      color,
      caption: `${entry.promptFragment ?? entry.id}${color ?? ''}`,
      fixed: isFixedElement(obj, entry),
    })
  }
  return [...groups.values()].sort(byPriority)
}

function byPriority(a: DesignGroup, b: DesignGroup): number {
  const tier = CATEGORY_PRIORITY.indexOf(a.entry.category) - CATEGORY_PRIORITY.indexOf(b.entry.category)
  if (tier !== 0) return tier
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
 * The two fixed shots — hall materials, then the site's landscape — then the
 * hall's own fittings, then the event's design items, each in priority order.
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
export function selectRefs(scene: SceneState, camera: SealedCamera | null): RefSelection {
  const groups = groupForRefs(scene, camera)
  const fixedGroups = groups.filter((g) => g.fixed)
  const designGroups = groups.filter((g) => !g.fixed)
  const warnings: string[] = []

  const keptFixed = fixedGroups.slice(0, MAX_FIXED_REFS)
  const cutFixed = fixedGroups.slice(MAX_FIXED_REFS)
  const fixedRefs = keptFixed.filter((g) => g.entry.thumbnail).map((g) => productRef(g, 'fixed'))

  // the slots the fixed elements did NOT take go back to the design list
  const budget = designRefBudget(fixedRefs.length)
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
    refs: [HALL_MATERIAL_REF, BACKGROUND_REF, ...fixedRefs, ...designRefs],
    groups,
    warnings,
  }
}
