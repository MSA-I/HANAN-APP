/**
 * כסא אורחים חופה — the clear acrylic "ghost" chair the guests sit on at the
 * ceremony. In the user's words: "the chair/s can only be placed on the dance
 * floor and in the reception area. The chair's material is clear plastic — it
 * needs replacing; the whole chair is the same material."
 *
 * ## Why a category of its own
 *
 * `listByCategory('seating')` fills THREE "chair model" dropdowns
 * (InspectorPanel.tsx:269,466 · PresetsSection.tsx:876) — the model a table rings
 * itself with. This chair is legal in exactly two rectangles, so choosing it for a
 * table standing anywhere else would produce twenty chairs that are illegal
 * wherever their table is. The choice would look legitimate and the scene would be
 * broken, which is the failure `seating.ts:8-12` describes in its own words about
 * the settee. Filtering the dropdowns instead moves one rule into three places and
 * forgets the fourth.
 *
 * The price is paid explicitly: `allowedOnDeck` (core/layout/collision.ts) has to
 * learn the category, or `checkPlacement` says yes on the deck while `clampToVenue`
 * declines to clamp it in — the two halves of one rule, apart again.
 *
 * ## Sizing — measured off the shipped GLB, not off the source file
 *
 * The source file's bounding box is 61.5 × 62.3, and that is an ARTEFACT: the chair
 * sits in it rotated. `suggest-yaw.mjs` puts the backrest at +Z with `--yaw -153.08`
 * (backrest centroid x = −0.04 cm across a 46 cm width — centred, so the angle is
 * right and not merely plausible), and the prepped file measures
 * 46.35 × 53.90 × 97.94. Catalogued from the raw box it would have been 33 % too
 * wide — 0.383 m² of footprint instead of 0.250, and every centimetre of that is a
 * distance the placement engine then demands from every neighbour.
 *
 * ⚠ `chuppahChair.test.ts` reads those numbers back OUT of `public/props/`, so this
 * copy cannot drift from the file the browser loads.
 */
import type { CatalogEntry } from '../types'
import { chairFootprint, chairMesh } from './seating'

export const chairChuppahGuest: CatalogEntry = {
  id: 'chair.chuppah-guest',
  category: 'chuppahChair',
  labelKey: 'chairChuppahGuest',
  promptFragment: 'a clear acrylic ghost chair with an oval medallion back',
  keywords: ['כסא', 'כיסא', 'חופה', 'אורח', 'שקוף', 'אקריל', 'טקס'],
  /**
   * gltf-transform `getBounds` on public/props/chair-chuppah-guest.glb, 2026-08-02
   * (46.35 × 97.94 × 53.90 cm, W × H × D). NOT glb-prep's own "final bounds" line:
   * that one transforms the pre-rotation AABB and so reports 83.0 × 83.4 for this
   * −153.08° yaw — the inflation its own comment (glb-prep.mjs:144-147) warns about.
   */
  defaultSize: { width: 46.35, depth: 53.9, height: 97.94 },
  resizable: [],
  minSize: {},
  maxSize: {},
  // 'none', like the six inventory chairs: real stock, and the dimension line
  // says nothing a product shot does not already say better
  librarySubtitle: 'none',
  /**
   * ONE slot, not the two the inventory chairs carry. Theirs exist so the plan can
   * tell upholstery from frame; this chair is one material end to end — the user
   * said so and the file agrees (a single material, `acrylic-00`). Two slots would
   * invent a distinction that does not exist.
   *
   * No `editableSlots`: the material is rebuilt in the renderer
   * (viewer3d/ObjectGroup.tsx `BUILT_MATERIALS`), so a colour picked here would be
   * overwritten the moment the GLB finishes loading.
   */
  materialSlots: [{ name: 'body', labelKey: 'body', defaultColor: '#dfe6e8' }],
  footprint: chairFootprint,
  buildMesh: (s) => chairMesh(s, 2),
  model: '/props/chair-chuppah-guest.glb',
  thumbnail: '/thumbs/chair-chuppah-guest.webp',
  /**
   * "Only on the dance floor and in the reception area", and `allowedZones` says
   * exactly that in both directions: the named zones stop refusing it
   * (collision.ts:879) and `bandViolations` (:740-747) refuses it EVERYWHERE ELSE.
   *
   * `within: 0` means TOUCHING, because `shapeGap` is never negative (collision.ts:314)
   * — a chair half over the dance floor's edge is allowed. That is the user's own
   * ruling of 2026-08-02, not a limitation being lived with.
   */
  allowedZones: [
    { kind: 'dancefloor', within: 0 },
    { kind: 'kabalatPanim', within: 0 },
  ],
  /**
   * One per event, like the canopy. The user's decision of 2026-08-02.
   *
   * What it drags with it:
   *  · `uniqueBlocker` (state/actions.ts) refuses a second one from the library and
   *    hands back — and selects — the one already placed;
   *  · `duplicateObjects`, `pasteSubtrees` and `mirrorCopyObjects` skip it and say
   *    so (`strings.status.uniqueNotCopied`), so Ctrl+D does not make a second.
   */
  unique: 'chuppahGuestChair',
}

export const chuppahChairEntries = [chairChuppahGuest]
