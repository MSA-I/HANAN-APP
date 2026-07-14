/**
 * Pure snapping math: grid snap + edge/center alignment against neighbors.
 * The 2D editor feeds world-space AABBs and a screen-space-derived threshold.
 */
import type { AABB } from './bounds'

export function snapValue(v: number, step: number): number {
  return Math.round(v / step) * step
}

export interface SnapLines {
  xs: number[]
  ys: number[]
}

export function collectSnapLines(aabbs: AABB[]): SnapLines {
  const xs: number[] = []
  const ys: number[] = []
  for (const b of aabbs) {
    xs.push(b.minX, (b.minX + b.maxX) / 2, b.maxX)
    ys.push(b.minY, (b.minY + b.maxY) / 2, b.maxY)
  }
  return { xs, ys }
}

export interface SnapResult {
  dx: number
  dy: number
  /** world coordinate of the matched alignment line, for guide rendering */
  guideX: number | null
  guideY: number | null
}

/**
 * Given the moving selection's AABB, find the best snap adjustment.
 * Alignment lines win over the grid; the grid applies to the AABB center.
 */
export function snapAABB(
  moving: AABB,
  lines: SnapLines,
  threshold: number,
  gridSize: number | null,
): SnapResult {
  const cx = (moving.minX + moving.maxX) / 2
  const cy = (moving.minY + moving.maxY) / 2

  const bestAxis = (edges: number[], candidates: number[]): { d: number; line: number } | null => {
    let best: { d: number; line: number } | null = null
    for (const edge of edges) {
      for (const line of candidates) {
        const d = line - edge
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) {
          best = { d, line }
        }
      }
    }
    return best
  }

  const bx = bestAxis([moving.minX, cx, moving.maxX], lines.xs)
  const by = bestAxis([moving.minY, cy, moving.maxY], lines.ys)

  let dx = bx?.d ?? 0
  let dy = by?.d ?? 0
  if (!bx && gridSize) dx = snapValue(cx, gridSize) - cx
  if (!by && gridSize) dy = snapValue(cy, gridSize) - cy

  return { dx, dy, guideX: bx?.line ?? null, guideY: by?.line ?? null }
}
