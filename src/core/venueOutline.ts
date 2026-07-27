/**
 * The venue's floor contour for the 2D plan.
 *
 * `outline` is produced by tools/glb-prep/extract-zones.mjs from the ZONE_FLOOR
 * marker and published on the venue pack. PLAN-07 owns that field and the
 * VenuePack type, so this reads it structurally rather than declaring it — the
 * editor must keep compiling and drawing before that lands, and the moment it
 * does the contour appears with no change here.
 *
 * Until then every pack returns null and the editor draws the size rectangle,
 * which is what it drew before.
 */
export function venueOutline(pack: unknown): [number, number][] | null {
  const candidate = (pack as { outline?: unknown } | null | undefined)?.outline
  if (!Array.isArray(candidate) || candidate.length < 3) return null
  const valid = candidate.every(
    (p): p is [number, number] =>
      Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]),
  )
  return valid ? (candidate as [number, number][]) : null
}
