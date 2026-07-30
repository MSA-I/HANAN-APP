/**
 * The ONLY place where units and coordinate conventions are converted.
 *
 * Plan space (model + 2D): cm, x → right, y → down, rotation in degrees
 * clockwise. three.js space (3D): meters, y-up, so plan (x, y, elevation)
 * maps to three (x, elevation, y) / 100, and plan rotation θ° maps to
 * rotation.y = -θ in radians.
 */
import type { Transform2D, Vec2 } from './model/types'

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

/** Rotate a plan-space vector clockwise (y-down) by `deg` degrees. */
export function rotateVec(v: Vec2, deg: number): Vec2 {
  const r = degToRad(deg)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

/**
 * World transform of a child given its parent's world transform.
 *
 * ⚠ A MIRRORED PARENT IS NOT JUST A SIGN ON X. A reflection reverses orientation,
 * so it does three things and all three are needed for a table's chairs to end up
 * where a real mirrored table's chairs would be:
 *
 *  1. the child's local x is flipped BEFORE the parent's rotation is applied —
 *     reflect first, then turn, which is `Rot(θ)·R`;
 *  2. every angle measured inside the reflection is NEGATED, because
 *     `R · Rot(ρ) · R⁻¹ = Rot(−ρ)`. A chair that faces 30° off its table's heading
 *     on the original faces −30° off it in the mirror;
 *  3. the flag itself propagates by XOR, so a mirrored piece on a mirrored table
 *     reads as unmirrored — which is what two reflections are.
 *
 * Fixing it HERE is what makes the feature one change rather than twenty: every
 * consumer of a world transform — collision's occupant shapes, `worldTransform`,
 * the prompt refs, the inspector's child readouts, the 3D surface-child drag —
 * goes through this function and its inverse.
 */
export function composeTransform(parent: Transform2D, local: Transform2D): Transform2D {
  const flipped = parent.mirrored ? { x: -local.position.x, y: local.position.y } : local.position
  const rotated = rotateVec(flipped, parent.rotation)
  const out: Transform2D = {
    position: { x: parent.position.x + rotated.x, y: parent.position.y + rotated.y },
    rotation: parent.mirrored ? parent.rotation - local.rotation : parent.rotation + local.rotation,
    elevation: parent.elevation + local.elevation,
  }
  // XOR, and the key is only ever ADDED — an unmirrored result must stay
  // byte-identical to what this returned before the flag existed.
  if (!!parent.mirrored !== !!local.mirrored) out.mirrored = true
  return out
}

/** Inverse of composeTransform: express a world transform relative to a parent. */
export function relativeTransform(parent: Transform2D, world: Transform2D): Transform2D {
  const dx = world.position.x - parent.position.x
  const dy = world.position.y - parent.position.y
  const unrotated = rotateVec({ x: dx, y: dy }, -parent.rotation)
  const out: Transform2D = {
    position: parent.mirrored ? { x: -unrotated.x, y: unrotated.y } : unrotated,
    rotation: parent.mirrored ? parent.rotation - world.rotation : world.rotation - parent.rotation,
    elevation: world.elevation - parent.elevation,
  }
  if (!!parent.mirrored !== !!world.mirrored) out.mirrored = true
  return out
}

/** cm → three.js meters. */
export function cmToM(cm: number): number {
  return cm / 100
}

/** Three.js ground-plane (x,z) metres → plan-space (x,y) centimetres. */
export function threeToPlan(x: number, z: number): Vec2 {
  return { x: x * 100, y: z * 100 }
}

/** Plan transform → three.js position/rotation (meters, y-up). */
export function planToThree(t: Transform2D): {
  position: [number, number, number]
  rotationY: number
} {
  return {
    position: [cmToM(t.position.x), cmToM(t.elevation), cmToM(t.position.y)],
    rotationY: -degToRad(t.rotation),
  }
}

/** Normalize degrees to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}
