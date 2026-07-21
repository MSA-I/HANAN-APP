/**
 * Chuppot (חופה) — the canopy the wedding ceremony happens under. What sets this
 * group apart from every other entry is `zoneKind: 'chuppah'`: the venue pack
 * marks one 760×425 rectangle as the ceremony spot, and clampToVenue
 * (state/actions.ts) teleports a matching object INTO the nearest such zone on
 * drop and never lets it be dragged out. The string has to equal the zone's
 * `kind` exactly — a typo does NOT degrade to "places freely", it makes the
 * object get pushed OUT of every restricted zone instead.
 *
 * These are also the first `category: 'structure'` entries; the category was
 * declared in types.ts and listed in CATEGORY_ORDER but had no members.
 *
 * Sizing. Every source model is a Tripo export that came out vertically
 * squashed, so a plain uniform rescale gives a canopy too low to stand under.
 * So each entry's HEIGHT is a real walk-under height, and its plan width comes
 * from the measured content aspect ratio of that model's own product shot —
 * a measured correction rather than taste, and the per-entry comments record
 * both numbers. Depth then follows the model's own raw plan ratio, so the
 * footprint itself is never distorted (the two round ones are the deliberate
 * exception, noted below). `defaultSize` is the EXACT bbox glb-prep printed
 * after normalisation, because propModel.ts fits the GLB to defaultSize and
 * never measures the loaded geometry — any drift there becomes a 2D/3D
 * mismatch. All eight fit the zone with room to spare: widest 349, deepest 347.
 *
 * ⚠ The Tripo filenames lie harder here than usual, so every mapping below came
 * from rendering the model and matching it to a product shot, never from the
 * name: `clear+acrylic+podium` is a chuppah (acrylic yes, podium no) and
 * `metal+table+frame` is the mirror-steel chuppah frame. One source model was
 * REJECTED: `classical+gazebo+3d+model.glb` is a masonry rotunda — eight
 * columns on a stepped circular plinth — and it is the one model with no
 * product shot in the user's חופות folder, so there is nothing to thumbnail it
 * from and no evidence it belongs to the real inventory.
 */
import type { Size3D } from '../../model/types'
import type { CatalogEntry, FootprintPart, MeshPart } from '../types'
import { fourLegs } from '../builders'

/** upright side in plan — the models' posts run 8–12 cm square */
const POST = 10
/** canopy slab / top rail thickness in the fallback mesh */
const TOP = 8

function chuppah(
  id: string,
  labelKey: string,
  model: string,
  size: Size3D,
  /** the GLB's measured mean baked base colour — 2D only, materials are baked */
  color: string,
  shape: 'rect' | 'round' = 'rect',
  /**
   * Where the uprights stand, as a fraction of the footprint. Draped models
   * puddle their fabric (and hang their florals) well outside the posts, so
   * their bbox is wider than the structure; bare ones stand at their own
   * corners. Eyeballed off the plan renders — it only shapes the fallback.
   */
  postSpan = 1,
): CatalogEntry {
  // on a round canopy the four fallback uprights sit ON the circle, not on the
  // corners of its bounding square
  const span = (s: Size3D) => {
    const f = shape === 'round' ? postSpan * Math.SQRT1_2 : postSpan
    return { w: s.width * f, d: s.depth * f }
  }
  return {
    id,
    category: 'structure',
    labelKey,
    defaultSize: size,
    resizable: [],
    minSize: {},
    maxSize: {},
    linkWidthDepth: shape === 'round',
    materialSlots: [
      // Tripo returns these as a single baked material, so both slots start from
      // the same measured mean; they are split so the plan view can tell the
      // uprights from the sheet. On the two bare structures the 'canopy' slot is
      // the top rail / cornice rather than fabric.
      { name: 'canopy', labelKey: 'canopy', defaultColor: color },
      { name: 'frame', labelKey: 'frame', defaultColor: color },
    ],
    footprint: (s) => {
      if (shape === 'round') {
        // a round chuppah is a continuous curtain — no uprights read in plan
        return {
          parts: [{ kind: 'circle', r: s.width / 2, slot: 'canopy' }],
          outline: { kind: 'circle', r: s.width / 2 },
        }
      }
      const { w, d } = span(s)
      const uprights: FootprintPart[] = [-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => ({
          kind: 'rect' as const,
          w: POST,
          h: POST,
          cx: (sx * (w - POST)) / 2,
          cy: (sz * (d - POST)) / 2,
          slot: 'frame',
        })),
      )
      return {
        parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'canopy' }, ...uprights],
        outline: { kind: 'rect', w: s.width, h: s.depth },
      }
    },
    // Fallback only (the GLB is the real render): four uprights carrying a flat
    // top, the silhouette all eight share.
    buildMesh: (s) => {
      const { w, d } = span(s)
      const top: MeshPart =
        shape === 'round'
          ? { shape: 'cylinder', dims: [s.width / 2, s.width / 2, TOP], offset: [0, s.height - TOP / 2, 0], slot: 'canopy' }
          : { shape: 'box', dims: [s.width, TOP, s.depth], offset: [0, s.height - TOP / 2, 0], slot: 'canopy' }
      return [...fourLegs(w, d, s.height - TOP, POST / 2, 'frame', POST), top]
    },
    model,
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
    // ceremony structure — lives only inside the venue's chuppah zone
    zoneKind: 'chuppah',
  }
}

const P = (file: string) => `/props/${file}`

export const chuppahEntries: CatalogEntry[] = [
  // Four posts, sheer white drapes gathered at each one under two rose balls,
  // flat top rail with a shallow centre peak. src "wedding+arch+3d+model.glb"
  // ↔ shot 06_07_04. The pairing needed no height correction at all — the
  // model's own width/height is 1.316 against the shot's measured 1.313 — which
  // is the strongest confirmation of any mapping here. It is also the only
  // model already facing the app's way (its long plan axis was X), so it is the
  // only one prepped without --yaw 90.
  chuppah('chuppah.draped-white', 'chuppahDrapedWhite', P('chuppah-draped-white.glb'), { width: 348, depth: 347, height: 265 }, '#d2d0d0', 'rect', 0.72),
  // Blush chiffon knotted at one top corner and swagged across, dried palm-fan
  // and rose sprays on two posts. src "wedding+arch+3d+model (2).glb" ↔ shot
  // 06_14_15 — the single knotted corner is what identifies it. Near-exact
  // proportions again (model 1.272 vs shot 1.256, a 1.3% stretch).
  chuppah('chuppah.draped-blush', 'chuppahDrapedBlush', P('chuppah-draped-blush.glb'), { width: 339, depth: 327, height: 270 }, '#c5b39d', 'rect', 0.72),
  // Ivory ruched jersey sleeving the posts and the canopy, with an arched
  // opening on each of the four faces. src "draped+archway+3d+model.glb" ↔ shot
  // 06_18_33. Stretched 9% taller than the model (1.278 → the shot's 1.169).
  chuppah('chuppah.ruched-ivory', 'chuppahRuchedIvory', P('chuppah-ruched-ivory.glb'), { width: 316, depth: 289, height: 270 }, '#d2c7b8', 'rect', 0.8),
  // Clear acrylic posts, a slack white sheet, and a full-width white floral
  // garland along the top. src "clear+acrylic+podium+3d+model.glb" ↔ shot
  // 06_17_47 — "podium" is Tripo's invention, the acrylic is real. The garland
  // is what fixed the facing: it spans the model's Z axis, so --yaw 90 turns it
  // to the front. 349 wide because the garland overhangs both ends; the posts
  // themselves stand at roughly 2.6 m. Stretched 8% (1.401 → 1.292).
  chuppah('chuppah.acrylic', 'chuppahAcrylic', P('chuppah-acrylic.glb'), { width: 349, depth: 281, height: 270 }, '#a6a49c', 'rect', 0.85),
  // Mirror-polished steel: four square posts and a plain rectangular top rim,
  // no fabric at all. src "metal+table+frame+3d+model.glb" — the name is why
  // this one was flagged as suspect up front, and the render alone stays
  // ambiguous (a bare box frame reads as a table base). Shot 06_21_57 settles
  // it: the same chrome frame, taller than wide, no top surface. The narrowest
  // of the eight and the only one under 2 m deep. Stretched 8% (0.965 → 0.893).
  chuppah('chuppah.frame-chrome', 'chuppahFrameChrome', P('chuppah-frame-chrome.glb'), { width: 250, depth: 162, height: 280 }, '#a0a09f'),
  // Round white chuppah: a ring of sheer curtain, drawn back at the front over
  // two rose clusters, with a back curtain closing the far side. src
  // "wedding+arch+3d+model (1).glb" ↔ shot 06_21_08. --yaw 90 turns the opening
  // to the front (−Z). Forced circular on purpose: the real product is round
  // and Tripo returned a 0.98×0.90 oval, so the 9% widening of the short axis
  // corrects the model rather than distorting it. Stretched 10% (1.464 → 1.327).
  chuppah('chuppah.round-white', 'chuppahRoundWhite', P('chuppah-round-white.glb'), { width: 338, depth: 338, height: 255 }, '#d2d1d1', 'round'),
  // The same round form in champagne, tied back over pampas sprays. src
  // "beige+draped+arch+3d+model.glb" ↔ shot 06_09_40, and the smallest of the
  // eight at 2.69 m across. Also the biggest correction: Tripo returned 1.321
  // against the shot's measured 1.016, so the height is stretched 30%. Left
  // uncorrected it would be a 2.69 m canopy only 2.04 m tall — not walk-under.
  chuppah('chuppah.round-beige', 'chuppahRoundBeige', P('chuppah-round-beige.glb'), { width: 269, depth: 269, height: 265 }, '#bfaf9b', 'round'),
  // ⚠ Not a canopy: a white lattice wedding ARCH — four panelled piers on
  // plinths carrying a dentil cornice, with a trellis-filled arch on each face
  // and nothing overhead. src "architectural+archway+3d+model.glb" ↔ shot
  // 06_08_49 (certain: lattice tympanum, panelled piers, cornice). Kept because
  // it is unambiguously the ceremony structure the user filed under חופות, and
  // labelled 'שער' rather than 'חופה' so the library does not claim otherwise —
  // drop this one line if the group should be canopies only. The tallest at
  // 2.9 m, and near enough to its shot to need almost no stretch (0.989 →
  // 1.021, 3%).
  chuppah('chuppah.arch-lattice', 'chuppahArchLattice', P('chuppah-arch-lattice.glb'), { width: 296, depth: 212, height: 290 }, '#bfbfbe'),
]
