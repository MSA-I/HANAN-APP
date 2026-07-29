/**
 * The venue's walls in plan — traced by hand in the SketchUp source with a single
 * material, `ZONE_CUT`, and read back by `tools/glb-prep/extract-cut.mjs`.
 *
 * ⚠ THIS REPLACED SLICING THE MODEL, and the replacement is the point. The old
 * `section.json` came from cutting venue.glb with a horizontal plane at 1.00 m,
 * and every hard problem the 2D plan had traced back to that one decision:
 *
 *   · the railing came back with ZERO instances — the plane passed exactly
 *     through the gap between its bottom rail and its top cap;
 *   · the hall's east wall came out as 36 severed stumps in a vertical comb down
 *     the middle of the drawing, because two cut ranges left a 9 cm strip that
 *     neither plane covered;
 *   · a door was not identifiable at all. The model carries no door material, so
 *     a doorway was indistinguishable from any other gap, and the plan could
 *     only draw `opening`, meaning "something was here and I do not know what".
 *
 * A painted face has none of those failure modes. There is no cut height to
 * choose, an opening is simply where the user did not paint, and the marking
 * lives in the source so it survives the next re-import — which matters, because
 * this model was re-imported three times in one day.
 *
 * The payload is TRIANGLES, not outlines. The faces are the wall footprints, so
 * filling them draws exactly what was drawn. Contour tracing would be a lossy
 * round trip through a raster for no gain.
 *
 * Coordinates are plan cm in the same frame as `restricted` and `floorAreas`:
 * the origin is ZONE_FLOOR's min corner.
 */

/** `[x1, y1, x2, y2, x3, y3]` in plan cm. */
export type CutTriangle = [number, number, number, number, number, number]

/** plan cm, the extent of what was painted — see `bounds` on VenueCut. */
export interface CutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface VenueCut {
  tris: CutTriangle[]
  /**
   * ⚠ THE BUILDING IS NOT INSIDE THE VENUE RECTANGLE, and this is how the export
   * finds that out. `size` is the box the editor frames and clamps furniture to;
   * the resort's north wall stands above the plan origin at y ≈ −640, so framing
   * the rectangle alone cut it off the sheet entirely (handoff/FOUND-06.md §1).
   * Computed here rather than trusted from the payload: it must describe the
   * triangles that survived parsing, not the ones the extractor started with.
   */
  bounds: CutBounds
}

/**
 * Validate a decoded payload. Separate from the fetch on purpose: vitest runs in
 * node and cannot exercise a component or a network call, so everything that can
 * be wrong about this data is checked where a test can reach it.
 *
 * Returns null rather than throwing — a venue whose cut file is missing or
 * malformed must still open, and simply draws without walls.
 */
export function parseVenueCut(raw: unknown): VenueCut | null {
  if (!raw || typeof raw !== 'object') return null
  const tris = (raw as { tris?: unknown }).tris
  if (!Array.isArray(tris)) return null

  const out: CutTriangle[] = []
  for (const t of tris) {
    if (!Array.isArray(t) || t.length < 6) continue
    const n = t.slice(0, 6).map(Number)
    // A non-finite coordinate does not announce itself downstream: Konva takes
    // NaN, draws nothing, and every comparison against it is false — so a range
    // check further along would pass it straight through.
    if (!n.every(Number.isFinite)) continue
    out.push(n as CutTriangle)
  }
  if (!out.length) return null
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const t of out) {
    for (let k = 0; k < 6; k += 2) {
      bounds.minX = Math.min(bounds.minX, t[k])
      bounds.maxX = Math.max(bounds.maxX, t[k])
      bounds.minY = Math.min(bounds.minY, t[k + 1])
      bounds.maxY = Math.max(bounds.maxY, t[k + 1])
    }
  }
  return { tris: out, bounds }
}

const cache = new Map<string, VenueCut | null>()
const inFlight = new Map<string, Promise<VenueCut | null>>()

/**
 * Fetch and cache a pack's cut. Held forever: it is a static asset of a static
 * pack, and re-parsing it on every venue switch would be work with no possible
 * new answer.
 */
export function loadVenueCut(url: string | undefined): Promise<VenueCut | null> {
  if (!url) return Promise.resolve(null)
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  const existing = inFlight.get(url)
  if (existing) return existing

  const request = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => parseVenueCut(raw))
    .catch(() => null)
    .then((cut) => {
      cache.set(url, cut)
      inFlight.delete(url)
      return cut
    })
  inFlight.set(url, request)
  return request
}

/** Synchronous peek, for a component that has already awaited the load once. */
export function cachedVenueCut(url: string | undefined): VenueCut | null {
  return url ? (cache.get(url) ?? null) : null
}
