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

/** World transform of a child given its parent's world transform. */
export function composeTransform(parent: Transform2D, local: Transform2D): Transform2D {
  const rotated = rotateVec(local.position, parent.rotation)
  return {
    position: { x: parent.position.x + rotated.x, y: parent.position.y + rotated.y },
    rotation: parent.rotation + local.rotation,
    elevation: parent.elevation + local.elevation,
  }
}

/** Inverse of composeTransform: express a world transform relative to a parent. */
export function relativeTransform(parent: Transform2D, world: Transform2D): Transform2D {
  const dx = world.position.x - parent.position.x
  const dy = world.position.y - parent.position.y
  const unrotated = rotateVec({ x: dx, y: dy }, -parent.rotation)
  return {
    position: unrotated,
    rotation: world.rotation - parent.rotation,
    elevation: world.elevation - parent.elevation,
  }
}

/** cm → three.js meters. */
export function cmToM(cm: number): number {
  return cm / 100
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
