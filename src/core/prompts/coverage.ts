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
 * ⛔ MEASURED, NOT CHOSEN — PLAN-05 C3 made this a blocking gate. Calibrated on
 * 2026-08-02 over a dressed resort hall (28 round tables, ~250 chairs, 22
 * planters and the three baked bar units) from all seven sealed angles: 34
 * product-groups measured, table in handoff/FOUND-C3.md.
 *
 * The measuring pass is 384×256 = 98,304 pixels, so ONE pixel is 1.017e-5, and
 * reading the sorted results in pixels is what settles the number:
 *
 *   0 px          5 groups   provably occluded (bars behind the camera)
 *   1 px          1 group    k2's back bar wall, 22 metres away
 *   5 px          1 group    s1's back bar wall
 *   ── the gap ──
 *   21 px         1 group    k2's planters, a real if small blob
 *   27 px         1 group    k2's 28 tables seen across the terrace
 *   71 px and up  25 groups  everything else, climbing smoothly to 55%
 *
 * The only knee in the data is between 5 and 21 pixels: below it are one- and
 * five-pixel flecks indistinguishable from an antialiased edge, above it are
 * small but real objects. 1e-4 is 9.8 pixels there, in the middle of that gap,
 * and 157 pixels at the capture's own 1536×1024.
 *
 * ⚠ PLAN-05 PROPOSED 0.001 AND THE MEASUREMENT REFUSED IT. Ten times higher, it
 * lands in the middle of the populated part of the distribution and cuts s2's
 * bar.resort-left (7.9e-4) and bar.back-wall (8.2e-4) — from the angle whose
 * own template calls the bar wall its subject. The plan was explicit that the
 * number had to be measured rather than assumed, and this is what that bought.
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

/**
 * Does this object occupy enough of the frame to be worth showing the model?
 *
 * ⚠ `undefined` means NOT MEASURED, and is therefore TRUE — not false. This
 * looks backwards and is the single most important line in the file.
 *
 * A coverage map holds a key for every object the oracle actually probed, with
 * an explicit 0 for the ones it probed and found invisible. An object can be
 * missing from the map entirely, and the measured reason is chairs: seating
 * renders as one InstancedMesh per table (viewer3d/ObjectGroup ChairInstances),
 * so individual chairs carry no `userData.objectId` and there is nothing to hide
 * and re-render. On a calibration run the frustum accepted 305 objects and the
 * oracle could probe 42 of them.
 *
 * Reading absence as zero would therefore have cut every chair in the hall out
 * of every export — the CHAIRS line gone from the prose and the chair's product
 * shot gone from the references, on a scene holding two hundred and fifty of
 * them. Absence of evidence is not evidence of absence: an unprobed object keeps
 * whatever the frustum said about it.
 */
export function isVisibleEnough(fraction: number | undefined): boolean {
  return fraction === undefined || fraction >= MIN_COVERAGE_FRACTION
}
