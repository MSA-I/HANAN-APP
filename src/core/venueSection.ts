/**
 * The venue's PLAN SECTION — the building cut through at eye-ish height, which
 * is what makes the 2D view read as an architectural drawing rather than as a
 * coloured rectangle: real walls at their real thickness, with the door and
 * window openings genuinely absent because no geometry crosses the plane there.
 *
 * Produced by `tools/glb-prep/extract-section.mjs` from the same prepped GLB the
 * 3D viewer loads, so the two views cannot describe different buildings. The
 * file is an asset next to the model (`public/venue-packs/<id>/section.json`)
 * rather than a literal in venuePacks.ts, because it is ~300 polylines and would
 * bury the pack it belongs to.
 *
 * Coordinates are plan cm in the same frame as `restricted` and `floorAreas`.
 *
 * ⚠ A section shows the cut and nothing else. The pool, the paving and the
 * planting are all BELOW the cut plane, so they are not in here — on a real
 * drawing they would be projection, and in this app they are the zone tints and
 * the furniture that VenueLayer already draws underneath these lines.
 */

/**
 * One run of the cut. `closed` means the run came back to its start, which for a
 * horizontal cut through a vertical wall is the wall's cross-section — fill it
 * and you have poché. An open run is a surface the plane clipped without going
 * around it, typically a sheet of glazing, and is drawn as a line.
 */
export interface SectionLine {
  closed: boolean
  pts: [number, number][]
}

export interface VenueSection {
  lines: SectionLine[]
}

/**
 * Validate a decoded section payload. Separate from the fetch on purpose: vitest
 * runs in node and cannot exercise a component or a network call, so everything
 * that can be wrong about this data is checked here where a test can reach it.
 *
 * Returns null rather than throwing. A venue whose section file is missing or
 * malformed must still open — it simply draws without walls, which is what every
 * pack did before this existed.
 */
export function parseVenueSection(raw: unknown): VenueSection | null {
  if (!raw || typeof raw !== 'object') return null
  const lines = (raw as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return null

  const out: SectionLine[] = []
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue
    const pts = (line as { pts?: unknown }).pts
    if (!Array.isArray(pts)) continue
    const clean: [number, number][] = []
    for (const p of pts) {
      if (!Array.isArray(p) || p.length < 2) continue
      const x = Number(p[0])
      const y = Number(p[1])
      // A non-finite coordinate is not a point that can be drawn, and it does not
      // announce itself downstream: Konva takes NaN, draws nothing, and every
      // comparison against it is false, so a range check would pass it through.
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      clean.push([x, y])
    }
    // two points is a segment and is legitimate; one is not a line at all
    if (clean.length < 2) continue
    out.push({ closed: (line as { closed?: unknown }).closed === true && clean.length >= 3, pts: clean })
  }
  return out.length ? { lines: out } : null
}

const cache = new Map<string, VenueSection | null>()
const inFlight = new Map<string, Promise<VenueSection | null>>()

/**
 * Fetch and cache a pack's section. Held forever: it is a static asset of a
 * static pack, a few tens of kB, and re-parsing it on every venue switch would
 * be work with no possible new answer.
 */
export function loadVenueSection(url: string | undefined): Promise<VenueSection | null> {
  if (!url) return Promise.resolve(null)
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  const existing = inFlight.get(url)
  if (existing) return existing

  const request = fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => parseVenueSection(raw))
    .catch(() => null)
    .then((section) => {
      cache.set(url, section)
      inFlight.delete(url)
      return section
    })
  inFlight.set(url, request)
  return request
}

/** Synchronous peek, for a component that has already awaited the load once. */
export function cachedVenueSection(url: string | undefined): VenueSection | null {
  return url ? (cache.get(url) ?? null) : null
}
