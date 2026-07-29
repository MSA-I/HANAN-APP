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
 * What the cut plane met, as `tools/glb-prep/extract-section.mjs` classifies it.
 *
 * `glazing` and `railing` come from the GLB material name and are therefore
 * facts. `column` is a measured rule about the shape of a closed loop (compact,
 * ≤ `columnMax` cm, aspect ≤ `columnRatio` — both thresholds are stored in the
 * asset so they are not magic numbers). `wall` is the rest of the solid.
 *
 * ⚠ `opening` means UNCLASSIFIED AND NOTHING ELSE. It is not a door and it is
 * not even reliably a hole: at the resort, 45 of the 47 openings are one wall
 * chopped into fragments by a 9 cm strip that neither cut plane covers, and 39
 * of them carry the wall material (handoff/01-section.md §6). There is no door
 * material anywhere in the model, so a doorway is not distinguishable from any
 * other gap, and nothing downstream may read one into this value.
 */
export const SECTION_KINDS = ['wall', 'glazing', 'railing', 'opening', 'column'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

/**
 * One run of the cut. `closed` means the run came back to its start, which for a
 * horizontal cut through a vertical wall is the wall's cross-section — fill it
 * and you have poché. An open run is a surface the plane clipped without going
 * around it, typically a sheet of glazing, and is drawn as a line.
 */
export interface SectionLine {
  kind: SectionKind
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
/**
 * A section file written before the extractor classified anything carries no
 * `kind` at all, and so does any pack that has not been re-cut. The fallback is
 * chosen to reproduce the OLD drawing exactly — closed was poché, open was a
 * line — so an unclassified asset looks precisely as it did rather than
 * silently acquiring glass it does not have.
 *
 * An unrecognised value takes the same road: it is data this build does not
 * understand, and guessing at it would put an invented class on the drawing.
 */
function readKind(raw: unknown, closed: boolean): SectionKind {
  return (SECTION_KINDS as readonly string[]).includes(raw as string)
    ? (raw as SectionKind)
    : closed
      ? 'wall'
      : 'opening'
}

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
    const closed = (line as { closed?: unknown }).closed === true && clean.length >= 3
    out.push({ kind: readKind((line as { kind?: unknown }).kind, closed), closed, pts: clean })
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
