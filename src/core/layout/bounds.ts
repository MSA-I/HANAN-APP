import type { Outline } from '../catalog/types'
import type { Transform2D } from '../model/types'
import { degToRad } from '../space'

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
