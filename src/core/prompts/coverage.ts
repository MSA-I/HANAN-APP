/**
 * How much of the frame each product actually occupies — the arithmetic half of
 * PLAN-05 C3's visibility oracle.
 *
 * > "יש זוויות שלא רואים את הרקע או את האלמנטים ולכן ההחלטה לצרף רפרנסים שלא
 * > נמצאים בתמונה נורא מבלבלת את המודל של התמונות"
 *
 * `objectsInFrame` (refs.ts) tests an axis-aligned box against the view frustum,
 * which answers "is it in front of the camera" and cannot answer "can it be
 * seen". A table standing behind the louvered feature wall passes the frustum
 * test, spends one of sixteen reference slots, AND gets a sentence in the prose
 * claiming it is in a picture it is invisible in. Both halves of that come from
 * the same `groups` list, so both are fixed by the same measurement.
 *
 * ⚠ WHY THIS FILE IS SEPARATE FROM THE MEASUREMENT. The measurement needs a
 * renderer — occlusion by the venue GLB is the entire point, and no amount of
 * CPU geometry gets alpha-cut foliage, glass and instanced chairs right. But
 * `src/core/prompts/` is renderer-free on purpose so it runs under vitest's
 * `environment: 'node'` (vite.config.ts), and there is no WebGL there. So the
 * GL lives in viewer3d/visibilityOracle.ts and everything that can be tested
 * lives here, in functions that take arrays of bytes and return numbers.
 */

/**
 * The smallest share of the frame a product must occupy to be worth one of the
 * sixteen input images.
 *
 * ⛔ MEASURED, NOT CHOSEN. PLAN-05 named 0.001 as a starting point and required
 * it be calibrated against a real scene before being fixed; the calibration is
 * in `handoff/FOUND-C3.md`, run over all seven sealed angles of a dressed
 * resort hall. What it showed is that the distribution has no knee anywhere near
 * 0.001 — the gap in the data sits three orders of magnitude lower, between
 * things that are genuinely occluded (exactly 0) and the smallest thing that is
 * genuinely visible. See FOUND-C3.md for the table and the reasoning.
 *
 * At 1536×1024 this is ~157 pixels, a smudge of about 12×12. Below that there is
 * nothing in the capture for a product photograph to attach to. The measuring
 * pass runs at 384×256, one sixteenth of the area, so the same fraction is ~10
 * pixels there — which is why the pass cannot go much smaller than it does.
 */
export const MIN_COVERAGE_FRACTION = 0.0001

/**
 * How many channel-triples differ between two RGBA readbacks of the same frame.
 *
 * `threshold` is per channel, 0–255, and exists because the two renders are not
 * bit-identical even where nothing changed: removing an object removes what it
 * contributed to the ContactShadows pass and to the environment's ambient
 * occlusion, so its neighbours shift by a value or two. A flat 0 would count
 * those as "the object is there", which is the wrong answer for the object and
 * for every object near it.
 *
 * Alpha is ignored: the canvas is opaque, so alpha is 255 everywhere and reading
 * it only costs time.
 */
export function diffCount(a: Uint8Array, b: Uint8Array, threshold = 6): number {
  const len = Math.min(a.length, b.length)
  let changed = 0
  for (let i = 0; i + 3 < len; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > threshold ||
      Math.abs(a[i + 1] - b[i + 1]) > threshold ||
      Math.abs(a[i + 2] - b[i + 2]) > threshold
    ) {
      changed++
    }
  }
  return changed
}

/** Changed pixels → share of the frame, clamped to 0..1. Zero pixels reads as 0. */
export function toFraction(changed: number, totalPixels: number): number {
  if (!Number.isFinite(changed) || !Number.isFinite(totalPixels) || totalPixels <= 0) return 0
  return Math.min(Math.max(changed / totalPixels, 0), 1)
}

/** `{id: changedPixels}` → `{id: fraction}`, one call per measured frame. */
export function coverageFrom(
  counts: Record<string, number>,
  totalPixels: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, changed] of Object.entries(counts)) out[id] = toFraction(changed, totalPixels)
  return out
}

/** Does this product occupy enough of the frame to be worth showing the model? */
export function isVisibleEnough(fraction: number | undefined): boolean {
  return (fraction ?? 0) >= MIN_COVERAGE_FRACTION
}
