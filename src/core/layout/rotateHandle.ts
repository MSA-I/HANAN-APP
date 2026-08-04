/**
 * The maths behind the rotation ring — the band a table is grabbed by to turn it.
 *
 * The ring TRACES THE TABLE'S OWN FOOTPRINT. That is the whole design: a
 * circumscribing circle round the 480×120 knights table would be ⌀560 of empty
 * band floating 2.2 m off each long side, sitting on top of whatever else is
 * standing there, and there would be no way to tell which table it belonged to.
 * A round table gets an annulus, a rectangular one gets a rounded-rect band, and
 * both hug the edge by the same `gapCm`.
 *
 * Everything here returns a geometry DESCRIPTION — numbers and a `kind` — never a
 * three.js or Konva object, so the same shape drives the Konva ring in the plan
 * and the mesh in 3D and the two cannot drift. Units are centimetres, angles are
 * plan degrees (clockwise, y-down); `core/space.ts` owns every conversion.
 */
import type { Outline } from '../catalog/types'
import type { Vec2 } from '../model/types'
import { normalizeDeg, radToDeg } from '../space'
import { snapAngle } from '../rotation'

/**
 * A circle band is `[rInner, rOuter]`. A rect band is the CENTRELINE rounded-rect
 * (`w`/`h`/`corner`) plus the stroke width — the four numbers a stroked rounded
 * rectangle needs in either renderer, with no second derivation at the call site.
 * Its edges are at `± band / 2` of the centreline, and its inner corner radius is
 * exactly `corner - band / 2`.
 */
export type RotateRing =
  | { kind: 'circle'; rInner: number; rOuter: number }
  | { kind: 'rect'; w: number; h: number; corner: number; band: number }

/** Grazing rays are rejected below this |direction.y| — see `isUsableRotationHit`. */
export const GRAZING_RAY_DIR_Y = 0.02

/** …as are hits further than this many ring radii from the table. */
export const MAX_HIT_RADIUS_FACTOR = 30

/**
 * The band that hugs `outline`: its inner edge `gapCm` outside the footprint, its
 * outer edge `gapCm + bandCm` outside.
 *
 * A RING outline (a circle carrying `rInner` — the ⌀380 table's hole) traces its
 * OUTER edge like any disc. The hole is inside the table, nowhere near where a
 * hand goes, and `r` is already the outer radius (see catalog/types.ts on why a
 * ring is not a third variant).
 *
 * The rect corner radius is the true offset curve: pushing a sharp corner
 * outwards by `gapCm` sweeps a quarter circle of radius `gapCm`, so the
 * CENTRELINE corner is `gapCm + bandCm / 2` and the inner and outer edges land on
 * `gapCm` and `gapCm + bandCm` by construction. It can never exceed half the
 * short side, so the shape is always drawable.
 */
export function rotateRingShape(outline: Outline, gapCm: number, bandCm: number): RotateRing {
  const gap = atLeastZero(gapCm)
  const band = atLeastZero(bandCm)
  if (outline.kind === 'circle') {
    return { kind: 'circle', rInner: outline.r + gap, rOuter: outline.r + gap + band }
  }
  return {
    kind: 'rect',
    w: outline.w + 2 * gap + band,
    h: outline.h + 2 * gap + band,
    corner: gap + band / 2,
    band,
  }
}

/**
 * The SHORT SIDE of a footprint, in centimetres — the one number that answers
 * "how big is this thing" for both outline variants.
 *
 * A circle answers its DIAMETER, not its radius, so a ⌀180 table and a 180×120
 * one both answer 180/120 and the rule below can be ONE rule rather than two that
 * drift apart.
 */
export function outlineShortSide(outline: Outline): number {
  return outline.kind === 'circle' ? 2 * outline.r : Math.min(outline.w, outline.h)
}

/**
 * The ceilings ARE the constants this band shipped with, so nothing ⌀120 and up
 * moves a micron: 180 × 0.10 = 18 → 12, 180 × 0.075 = 13.5 → 9, and 120 is the
 * exact break-even. ⌀380, ⌀180, square-160 and knights-480 are bit-for-bit
 * unchanged.
 */
export const RING_GAP_MAX_CM = 12
export const RING_BAND_MAX_CM = 9

/**
 * Gap and band for an object of this size (PLAN-10 §8).
 *
 * WHY THIS EXISTS. The two numbers were fixed world centimetres, tuned for
 * tables — this file's own header says so ("the band a TABLE is turned by"). On a
 * ⌀180 table a 12 cm gap and a 9 cm band read as a halo 1.23× the table. On a
 * 36 cm place setting the SAME centimetres are enormous: measured in the live
 * viewer, the ring's world bounding box came out 110.9 × 112.7 cm around a piece
 * 36 × 46.3 cm — **3.08× its width**, covering four neighbouring settings and the
 * middle of the cloth. A hall owner's words: "the circle for turning should be
 * the size of the thing".
 *
 * So the band is a PROPORTION with a floor and a ceiling. The ceiling keeps every
 * table exactly as it is; the floor keeps a target a hand can still catch on a
 * small prop.
 *
 * ⚠ It lives HERE, not in the renderer, for the reason stated at the top of this
 * file: the same shape drives the Konva ring in the plan and the mesh in 3D, and
 * deriving the size twice is precisely the drift that rule exists to prevent.
 */
export function rotateRingMetrics(shortSideCm: number): { gapCm: number; bandCm: number } {
  const s = Number.isFinite(shortSideCm) && shortSideCm > 0 ? shortSideCm : 0
  return {
    gapCm: Math.min(RING_GAP_MAX_CM, Math.max(3, s * 0.1)),
    bandCm: Math.min(RING_BAND_MAX_CM, Math.max(2.5, s * 0.075)),
  }
}

/**
 * How far the ring reaches from the table's centre — its circumscribing radius.
 *
 * Exported because `isUsableRotationHit` needs exactly this number and both
 * renderers would otherwise each work it out, which is how the same rule ends up
 * meaning two different things in 2D and 3D.
 */
export function rotateRingRadius(ring: RotateRing): number {
  return ring.kind === 'circle' ? ring.rOuter : Math.hypot(ring.w / 2, ring.h / 2) + ring.band / 2
}

/**
 * The plan angle from `centre` to `point`: 0 straight up (-y), growing CLOCKWISE,
 * normalised to [0, 360).
 *
 * Clockwise-positive because plan space is y-DOWN — the same convention an
 * object's `transform.rotation` uses, so the number this returns can be compared
 * with and assigned to a rotation without a sign flip anywhere. Getting the sign
 * wrong does not fail loudly: the table turns, just the wrong way, and only under
 * the pointer rather than with it.
 *
 * A point exactly on the centre has no direction at all; it returns 0 rather than
 * whatever `atan2(0, -0)` happens to be (it is π, which would snap the table to a
 * half turn the moment a click landed dead centre).
 */
export function planAngleBetween(centre: Vec2, point: Vec2): number {
  const dx = point.x - centre.x
  const dy = point.y - centre.y
  if (dx === 0 && dy === 0) return 0
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0
  // atan2(dx, -dy): -y is the zero direction and +x is a quarter turn on from it
  return normalizeDeg(radToDeg(Math.atan2(dx, -dy)))
}

export interface RotationDrag {
  /** the object's rotation when the ring was grabbed */
  startRotation: number
  /** `planAngleBetween` at the grab */
  startAngle: number
  /** `planAngleBetween` now */
  currentAngle: number
  /** 0 for free rotation; `ROTATION_SNAP_DEG` while Shift is held */
  snapDeg: number
}

/**
 * Where the object should now be pointing, in normalised plan degrees.
 *
 * The rotation follows the pointer by the SWEPT ANGLE, not by the pointer's
 * absolute bearing: grabbing the ring anywhere turns the table from where it
 * already was, instead of snapping its front to wherever the hand first landed.
 *
 * The snap is applied to the RESULT, not to the swept delta, so a snapped table
 * lands on absolute multiples of the step — the same angles `rotationSnapsDeg`
 * draws ticks at, which is what makes two snapped tables parallel to each other
 * and to the hall. Snapping the delta instead would preserve whatever arbitrary
 * angle the table started at. The snap itself is `core/rotation.ts`'s, never
 * reimplemented here.
 */
export function rotationFromDrag({
  startRotation,
  startAngle,
  currentAngle,
  snapDeg,
}: RotationDrag): number {
  return snapAngle(startRotation + (currentAngle - startAngle), snapDeg)
}

/**
 * Is this pointer ray worth turning a table by?
 *
 * The 3D rotation ring is picked by intersecting the pointer ray with the ground
 * plane, and that intersection is unstable in two ways that both end with the
 * table spinning wildly under a hand that barely moved:
 *
 *  - A near-horizontal camera gives a ray almost parallel to the floor, so a
 *    one-pixel move slides the hit point by metres. `|rayDirY| < 0.02` is about
 *    1.1° off horizontal, the point past which a pixel is worth more than the
 *    ring is wide.
 *  - Even a healthy ray can land far outside the venue when the camera is low.
 *    A hit beyond 30 ring radii is not aimed at this table.
 *
 * The 2D plan has no ray, so it passes `rayDirY: 1` (straight down) and only the
 * distance test bites. Both callers go through this one function so "the table
 * span wildly" can only ever be fixed once.
 */
export function isUsableRotationHit(
  centre: Vec2,
  point: Vec2,
  ringRadiusCm: number,
  rayDirY: number,
): boolean {
  if (!Number.isFinite(rayDirY) || Math.abs(rayDirY) < GRAZING_RAY_DIR_Y) return false
  if (!Number.isFinite(ringRadiusCm) || ringRadiusCm <= 0) return false
  const distance = Math.hypot(point.x - centre.x, point.y - centre.y)
  if (!Number.isFinite(distance)) return false
  return distance <= MAX_HIT_RADIUS_FACTOR * ringRadiusCm
}

function atLeastZero(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
