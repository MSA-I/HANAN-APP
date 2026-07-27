import type { Outline } from '../catalog/types'
import type { Transform2D, Vec2 } from '../model/types'
import { degToRad, rotateVec } from '../space'

export interface AABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** World-space axis-aligned bounding box of a rotated outline. */
export function outlineAABB(world: Transform2D, outline: Outline): AABB {
  const { x, y } = world.position
  if (outline.kind === 'circle') {
    return { minX: x - outline.r, minY: y - outline.r, maxX: x + outline.r, maxY: y + outline.r }
  }
  const rad = degToRad(world.rotation)
  const hw = (Math.abs(Math.cos(rad)) * outline.w + Math.abs(Math.sin(rad)) * outline.h) / 2
  const hh = (Math.abs(Math.sin(rad)) * outline.w + Math.abs(Math.cos(rad)) * outline.h) / 2
  return { minX: x - hw, minY: y - hh, maxX: x + hw, maxY: y + hh }
}

/**
 * Is a world-space point inside a placed outline (rotation-aware)?
 *
 * A ring counts its hole as INSIDE. The hole is a place you put things — the
 * whole point of the ⌀380's centre — so hit-testing it as a miss would make the
 * table impossible to drop decor into, and would let a click through to whatever
 * is behind it. Callers that need the hole specifically use `pointInHole`.
 */
export function pointInOutline(point: Vec2, world: Transform2D, outline: Outline): boolean {
  const dx = point.x - world.position.x
  const dy = point.y - world.position.y
  if (outline.kind === 'circle') return Math.hypot(dx, dy) <= outline.r
  const local = rotateVec({ x: dx, y: dy }, -world.rotation)
  return Math.abs(local.x) <= outline.w / 2 && Math.abs(local.y) <= outline.h / 2
}

/** Radius of an outline's central hole; 0 for a solid disc or a rect. */
export function holeRadius(outline: Outline): number {
  return outline.kind === 'circle' ? (outline.rInner ?? 0) : 0
}

/**
 * Is a world-space point in the OPEN CENTRE of a ring — over the floor rather
 * than over the table top?
 *
 * Always false for a solid outline, so a caller may ask unconditionally.
 * Rotation-independent by construction: a ring is symmetric about its centre.
 */
export function pointInHole(point: Vec2, world: Transform2D, outline: Outline): boolean {
  const r = holeRadius(outline)
  if (r <= 0) return false
  return Math.hypot(point.x - world.position.x, point.y - world.position.y) < r
}

/** Ray-cast point-in-polygon over a closed ring of [x, y] pairs (venue floorAreas). */
export function pointInPolygon(point: Vec2, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

export function aabbUnion(boxes: AABB[]): AABB {
  return boxes.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }))
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

export function aabbCenter(a: AABB): { x: number; y: number } {
  return { x: (a.minX + a.maxX) / 2, y: (a.minY + a.maxY) / 2 }
}
