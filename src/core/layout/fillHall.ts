/**
 * Pure grid packing for the two one-click layout operations: filling the free
 * floor with tables, and spreading ceiling fixtures over the hall. Both are the
 * same problem — drop equal cells into a set of polygons, skipping no-go rects
 * and anything already there — so both go through `fillHallSlots`.
 */
import { getCatalogEntry } from '../catalog/registry'
import type { SeatingConfig, Vec2, Venue } from '../model/types'
import type { RestrictedZone, VenuePack } from '../venuePacks'
import { aabbIntersects, aabbUnion, outlineAABB, pointInPolygon, type AABB } from './bounds'
import { computeSeatTransforms } from './seatLayout'

/** Service aisle between two table cells, cm. */
export const DEFAULT_AISLE = 90
/**
 * Cap on one fill. Not a layout limit — an undo-memory one: each table drags ~12
 * chairs, and zundo keeps 100 snapshots of a flat `scene.objects` record.
 */
export const MAX_FILL = 60
/** Keep a ceiling fixture this far off a wall, cm. */
export const CEILING_INSET = 60
export const MAX_CEILING = 40

/**
 * Which restricted zones are still worth hanging something over. Zones are
 * FLOOR no-go areas, so most of them are exactly where you want a chandelier —
 * but not the open-air pool or the corridor.
 */
const CEILING_OVER = new Set(['dancefloor', 'bar', 'chuppah'])

/** Overlap tests shrink by this (cm) so cells that merely touch are not rejected. */
const TOUCH_EPS = 0.5

const ORIGIN = { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 }

export function rectRing(x: number, y: number, w: number, d: number): [number, number][] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ]
}

const zoneBox = (z: RestrictedZone): AABB => ({
  minX: z.x,
  minY: z.y,
  maxX: z.x + z.width,
  maxY: z.y + z.depth,
})

const shrink = (b: AABB, by: number): AABB => ({
  minX: b.minX + by,
  minY: b.minY + by,
  maxX: b.maxX - by,
  maxY: b.maxY - by,
})

/**
 * Footprint of a table WITH its chair ring at rotation 0 — the cell one preset
 * occupies. Derived from the same seat math the editor uses rather than being a
 * table-size guess, so it stays right if seat layout ever changes.
 */
export function tableCellSize(
  tableCatalogId: string,
  seating: SeatingConfig,
): { width: number; depth: number } {
  const table = getCatalogEntry(tableCatalogId)
  const outline = table.footprint(table.defaultSize).outline
  const chair = getCatalogEntry(seating.chairCatalogId)
  const chairOutline = chair.footprint(chair.defaultSize).outline
  const boxes: AABB[] = [outlineAABB(ORIGIN, outline)]
  for (const t of computeSeatTransforms(outline, seating, chair.defaultSize)) {
    boxes.push(outlineAABB(t, chairOutline))
  }
  const b = aabbUnion(boxes)
  return { width: b.maxX - b.minX, depth: b.maxY - b.minY }
}

/**
 * A cell counts as inside a polygon when all 9 sample points (corners, edge
 * midpoints, centre) are.
 *
 * ponytail: floorAreas are ZONE_FLOOR faces from SketchUp — rectilinear and
 * 15–25 m across against a 2.8 m table. True polygon clipping would be ~10× the
 * code to catch a notch narrow enough to slip between samples yet wide enough to
 * matter, which cannot exist at these scales. Sampling also fails safe: it
 * over-rejects near corners, never over-accepts.
 */
function boxInRing(b: AABB, ring: [number, number][]): boolean {
  const xs = [b.minX, (b.minX + b.maxX) / 2, b.maxX]
  const ys = [b.minY, (b.minY + b.maxY) / 2, b.maxY]
  for (const x of xs) {
    for (const y of ys) {
      if (!pointInPolygon({ x, y }, ring)) return false
    }
  }
  return true
}

/** How many cells of `size` fit along `span` with `aisle` between them. */
function countAlong(span: number, size: number, aisle: number): number {
  if (span < size) return 0
  return Math.floor((span - size) / (size + aisle)) + 1
}

export interface FillRequest {
  /** placeable polygons, plan cm */
  areas: [number, number][][]
  /** no-go rectangles a cell may not touch */
  zones: RestrictedZone[]
  cell: { width: number; depth: number }
  aisle: number
  /** footprints already in the scene — a fill never lands on existing furniture */
  occupied: AABB[]
  max: number
}

/** Centres, row-major per polygon. Deterministic: same input, same output. */
export function fillHallSlots(req: FillRequest): Vec2[] {
  const { cell, aisle, max } = req
  const hw = cell.width / 2
  const hd = cell.depth / 2
  const taken: AABB[] = [...req.occupied]
  const out: Vec2[] = []

  for (const ring of req.areas) {
    if (out.length >= max) break
    const xs = ring.map((p) => p[0])
    const ys = ring.map((p) => p[1])
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const nx = countAlong(x1 - x0, cell.width, aisle)
    const ny = countAlong(y1 - y0, cell.depth, aisle)
    if (!nx || !ny) continue

    // Centre the run in the area's bbox — a grid flush against one wall reads as
    // a bug rather than a layout.
    const runW = nx * cell.width + (nx - 1) * aisle
    const runD = ny * cell.depth + (ny - 1) * aisle
    const startX = x0 + (x1 - x0 - runW) / 2 + hw
    const startY = y0 + (y1 - y0 - runD) / 2 + hd

    for (let row = 0; row < ny && out.length < max; row++) {
      for (let col = 0; col < nx && out.length < max; col++) {
        const p = {
          x: startX + col * (cell.width + aisle),
          y: startY + row * (cell.depth + aisle),
        }
        const box = { minX: p.x - hw, minY: p.y - hd, maxX: p.x + hw, maxY: p.y + hd }
        if (!boxInRing(box, ring)) continue
        const test = shrink(box, TOUCH_EPS)
        if (req.zones.some((z) => aabbIntersects(test, zoneBox(z)))) continue
        if (taken.some((b) => aabbIntersects(test, b))) continue
        taken.push(box)
        out.push(p)
      }
    }
  }
  return out
}

/** Polygons a ceiling fixture may hang over: the free floor plus the covered zones. */
export function ceilingAreas(
  pack: VenuePack | undefined,
  venue: Pick<Venue, 'size'>,
): [number, number][][] {
  const whole = rectRing(0, 0, venue.size.width, venue.size.depth)
  if (!pack) return [whole]
  const rings: [number, number][][] = [...(pack.floorAreas ?? [whole])]
  for (const z of pack.restricted ?? []) {
    if (z.kind && CEILING_OVER.has(z.kind)) rings.push(rectRing(z.x, z.y, z.width, z.depth))
  }
  return rings
}
