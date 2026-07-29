/**
 * Fits the sun's shadow camera to the hall, plus anything placed outside it.
 *
 * The rig used to aim a SYMMETRIC orthographic box of `max(W, D) * 0.9` at the
 * venue centre. On the resort (60.51 x 25.44 m) that is a 109 m box rendered
 * into a 2048 map — 5.3 cm per texel, while a chair leg is 4 cm across. Every
 * leg's shadow fell between texels and dissolved into stair-steps, which is the
 * "jagged, low quality, imprecise" the user reported (source doc §46). This
 * note used to end "nothing about the light or the FILTER was wrong; the box
 * was" — R3 measured that and it is false. The renderer was running BASIC
 * shadows, one unfiltered nearest tap, the whole time (see Scene3D's `shadows`
 * prop). The box was one of two causes, and the smaller one.
 *
 * An orthographic camera takes left/right/top/bottom INDEPENDENTLY, so the box
 * does not have to stay centred on the light's axis: projecting an AABB into the
 * light's own view space gives four numbers that wrap it exactly. The hall then
 * costs ~60 x 32 m instead of 109 x 109 — a sixth of the area for the same map.
 *
 * WHAT goes into that AABB is `shadowContent()`, and in R3 it changed: the box
 * is the VENUE unioned with the placed objects, where it used to be the placed
 * objects ALONE. Objects-alone is a trap. Cluster the furniture into one corner
 * and the box shrinks onto the cluster, so the truss, the pergola, the columns
 * and the far half of the floor fall OUTSIDE the shadow frustum and receive no
 * sun shadow at all — that is the "bug with the shadow and the sun in certain
 * areas of the hall, especially at the edges" half of the report. (The other
 * half is texel size, which shadowFit.test.ts measures.)
 *
 * The price is one direction of texel size, and it is smaller than it looks: an
 * EMPTY hall already fitted the venue box, so every scene now pays what the
 * emptiest one always paid, and nothing more. A wall-to-wall hall is unchanged,
 * because its content already spanned the venue.
 *
 * Two things must NOT be tightened along with it:
 * - `near` stays fitted to the VENUE, not to the content. Anything between the
 *   sun and the box still has to cast into it; clipping the near plane down to
 *   the furniture would delete the roof structure's shadows on the floor.
 * - The box never shrinks below `minHalfExtent`. With the venue always in the
 *   union this floor no longer bites on a real pack, but it is still what keeps
 *   a tiny procedural room from fitting a 2 m box around one chair.
 */
import * as THREE from 'three'
import type { SceneState } from '../core/model/types'
import { cmToM } from '../core/space'
import { isObjectVisible, worldTransform } from '../state/selectors'

/** An axis-aligned box in three-space metres. */
export interface Bounds3 {
  min: [number, number, number]
  max: [number, number, number]
}

/** Orthographic shadow-camera extents, in the light's view space. */
export interface ShadowBox {
  left: number
  right: number
  top: number
  bottom: number
  near: number
  far: number
}

export interface ShadowFitOptions {
  /** metres of slack around the fitted content */
  margin: number
  /** metres — the smallest half-extent the box may collapse to */
  minHalfExtent: number
}

const UP = new THREE.Vector3(0, 1, 0)
const scratchEye = new THREE.Vector3()
const scratchTarget = new THREE.Vector3()
const scratchBasis = new THREE.Matrix4()
const scratchX = new THREE.Vector3()
const scratchY = new THREE.Vector3()
const scratchZ = new THREE.Vector3()
const scratchCorner = new THREE.Vector3()

/**
 * World AABB (metres) of every visible object, including attached chairs and
 * surface decor. Footprints are taken as a rotation-invariant disc — half the
 * footprint diagonal — so a table yawed to any angle is covered without
 * re-deriving its outline on every drag frame.
 *
 * Returns null for an empty scene; the caller falls back to the venue.
 */
export function contentBounds(scene: SceneState): Bounds3 | null {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const id of Object.keys(scene.objects)) {
    const obj = scene.objects[id]
    if (!isObjectVisible(scene, id)) continue
    const world = worldTransform(scene, id)
    if (!world) continue

    const radius = 0.5 * Math.hypot(obj.size.width, obj.size.depth)
    if (world.position.x - radius < minX) minX = world.position.x - radius
    if (world.position.x + radius > maxX) maxX = world.position.x + radius
    if (world.position.y - radius < minZ) minZ = world.position.y - radius
    if (world.position.y + radius > maxZ) maxZ = world.position.y + radius
    if (world.elevation < minY) minY = world.elevation
    if (world.elevation + obj.size.height > maxY) maxY = world.elevation + obj.size.height
  }

  if (minX > maxX) return null
  // Reach down to the floor: a hung item's own shadow lands there, and so does
  // everything standing under it.
  return {
    min: [cmToM(minX), cmToM(Math.min(minY, 0)), cmToM(minZ)],
    max: [cmToM(maxX), cmToM(maxY), cmToM(maxZ)],
  }
}

/** Smallest box containing both. */
export function unionBounds(a: Bounds3, b: Bounds3): Bounds3 {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  }
}

/** Clip `box` to `limit`, keeping it non-empty even if the two do not overlap. */
export function clampBounds(box: Bounds3, limit: Bounds3): Bounds3 {
  const axis = (i: 0 | 1 | 2): [number, number] => {
    const lo = Math.min(Math.max(box.min[i], limit.min[i]), limit.max[i])
    const hi = Math.max(Math.min(box.max[i], limit.max[i]), limit.min[i])
    return lo <= hi ? [lo, hi] : [lo, lo]
  }
  const [x0, x1] = axis(0)
  const [y0, y1] = axis(1)
  const [z0, z1] = axis(2)
  return { min: [x0, y0, z0], max: [x1, y1, z1] }
}

/**
 * The lateral AABB the sun's shadow box must cover for `scene`: the venue,
 * unioned with whatever is placed (clipped to `limit`, so malformed coordinates
 * cannot blow the box back out to the whole desert).
 *
 * `venue` is unconditional — see the module header. `limit` is expected to be
 * the venue plus a margin, since objects legitimately stand on zone platforms
 * and rise above the wall height.
 */
export function shadowContent(scene: SceneState, venue: Bounds3, limit: Bounds3): Bounds3 {
  const found = contentBounds(scene)
  return found ? unionBounds(clampBounds(found, limit), venue) : venue
}

/**
 * A world point in the shadow camera's own space: `[u, v, d]` where u/v are the
 * axes `left…right` and `bottom…top` are measured on, and d is distance in front
 * of the light. Exported so a test can assert a corner of the hall really does
 * land inside the fitted box — the one failure mode this whole change risks.
 */
export function toLightSpace(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  point: readonly [number, number, number],
): [number, number, number] {
  scratchEye.set(eye[0], eye[1], eye[2])
  scratchBasis.lookAt(scratchEye, scratchTarget.set(target[0], target[1], target[2]), UP)
  scratchCorner.set(point[0], point[1], point[2]).sub(scratchEye)
  return [
    scratchCorner.dot(scratchX.setFromMatrixColumn(scratchBasis, 0)),
    scratchCorner.dot(scratchY.setFromMatrixColumn(scratchBasis, 1)),
    -scratchCorner.dot(scratchZ.setFromMatrixColumn(scratchBasis, 2)),
  ]
}

function corners(b: Bounds3, visit: (x: number, y: number, z: number) => void): void {
  for (const x of [b.min[0], b.max[0]]) {
    for (const y of [b.min[1], b.max[1]]) {
      for (const z of [b.min[2], b.max[2]]) visit(x, y, z)
    }
  }
}

/**
 * Orthographic extents for a directional light standing at `eye` and aimed at
 * `target`, wrapping `content` laterally and `depth` along the light axis.
 *
 * The basis is built exactly the way three builds the shadow camera's — the
 * shadow camera is placed at the light and `lookAt`s the light target with the
 * default up — so the numbers land in the same space the projection will use.
 */
export function fitShadowCamera(
  eye: readonly [number, number, number],
  target: readonly [number, number, number],
  content: Bounds3,
  depth: Bounds3,
  opts: ShadowFitOptions,
): ShadowBox {
  scratchEye.set(eye[0], eye[1], eye[2])
  scratchTarget.set(target[0], target[1], target[2])
  // Matrix4.lookAt nudges the degenerate straight-overhead case for us.
  scratchBasis.lookAt(scratchEye, scratchTarget, UP)
  scratchX.setFromMatrixColumn(scratchBasis, 0)
  scratchY.setFromMatrixColumn(scratchBasis, 1)
  scratchZ.setFromMatrixColumn(scratchBasis, 2)

  let left = Infinity
  let right = -Infinity
  let bottom = Infinity
  let top = -Infinity
  corners(content, (x, y, z) => {
    scratchCorner.set(x, y, z).sub(scratchEye)
    const u = scratchCorner.dot(scratchX)
    const v = scratchCorner.dot(scratchY)
    if (u < left) left = u
    if (u > right) right = u
    if (v < bottom) bottom = v
    if (v > top) top = v
  })

  // The camera looks down its own -z, so distance in front of it is -z.
  let near = Infinity
  let far = -Infinity
  corners(unionBounds(depth, content), (x, y, z) => {
    const d = -scratchCorner.set(x, y, z).sub(scratchEye).dot(scratchZ)
    if (d < near) near = d
    if (d > far) far = d
  })

  const grow = (lo: number, hi: number): [number, number] => {
    const centre = (lo + hi) / 2
    const half = Math.max((hi - lo) / 2 + opts.margin, opts.minHalfExtent)
    return [centre - half, centre + half]
  }
  const [l, r] = grow(left, right)
  const [b, t] = grow(bottom, top)

  return {
    left: l,
    right: r,
    bottom: b,
    top: t,
    near: Math.max(0.1, near - opts.margin),
    far: Math.max(far + opts.margin, near + 1),
  }
}
