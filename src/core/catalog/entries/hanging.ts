/**
 * Ceiling-hung lighting (phase 2.6). placement:'ceiling' is what makes these
 * different from every other entry: they are still TOP-LEVEL objects (not
 * attached children like table decor), but factory.createObject seeds their
 * elevation to `venue.wallHeight − height` so the model's top meets the ceiling
 * and it hangs down — the drop length IS the entry height. It also snaps them to
 * a crossing of the venue's ceiling beam grid; nothing hangs between beams.
 *
 * `height` stays the FULL modelled drop — body plus whatever cord the GLB itself
 * contains — because the file is normalised to exactly this box. The hang-height
 * slider (source doc §13) moves the whole fixture down from that seeded top and
 * the viewer draws a procedural cord across the gap it opens (`HangingCord` in
 * viewer3d/ObjectGroup.tsx). So `height` is NOT "body only": redefining it that
 * way would shrink every GLB. `bodyFraction` below stays the fraction of that
 * drop the body occupies, and is still only used by the procedural fallback.
 *
 * These five ARE the 'lighting' category: it holds exactly the ceiling-hung
 * fixtures, so `placement: 'ceiling'` and `category: 'lighting'` say the same
 * thing here. The floor-standing arc lamp stays in 'decor' — it is furniture
 * that happens to light, not something hung from the truss.
 *
 * The GLBs are Tripo models normalised by glb-prep --mode prop. All five are
 * catalogued at 2.5× their normalised bounds (corrections document §8: "a scale
 * of ×2.5 for all the chandeliers") — the venue's real fixtures read far larger
 * in an 11.6 m hall than the Tripo exports do. The files are NOT re-prepped, so
 * each entry states its `modelSize` (the bounds glb-prep actually wrote) and the
 * loader grows the model by `size / modelSize`; without it the ratio would be 1
 * and the 3D fixture would silently stay small while the 2D footprint grew.
 * Those bounds are MEASURED, not merely declared — all five files were re-read
 * vertex by vertex on 2026-07-28 and agree to within 0.4 mm (Draco quantisation;
 * see handoff/FOUND-03.md §A1-1, and FOUND-02.md §A3-1 for the round-1 case
 * where an entry and its file HAD drifted apart unnoticed).
 * Materials are baked (see propModel.ts) — the single slot only colours the 2D
 * shape, and its value is the model's measured mean base colour, not a guess.
 *
 * ⚠ `height` feeds `hangRange` (layout/beams.ts), so ×2.5 eats headroom. In the
 * resort (roof 1160, truss 895, MAX_DROP_FROM_CEILING 400) the band is
 * [760 − height, 895 − height]: it is 135 cm wide whatever the fixture, because
 * both ends move together, and it only degenerates once height passes 760. The
 * tallest here is 300, so all five keep the full slider. Verified in
 * beams.test.ts and reported in handoff/03-sizes.md.
 *
 * ⚠ Only TWO of the three "hanging" models actually hang. decor-chandelier-crystal
 * .glb is NOT a chandelier — rendering it (2026-07-20) shows an arched brass
 * floor lamp standing on a weighted disc base, matching its product shot. It
 * lives in entries/decor.ts as a floor object instead. (Its filename is now
 * misleading; renaming the asset is worth doing when nothing else is in flight.)
 *
 * The three chandeliers come from 7 unnormalised source GLBs that turned out to
 * be Tripo re-rolls of only THREE real products — the source folder has 3 shots
 * of the diamond, 2 of the basket and 2 of the candelabra. One entry per product
 * (real-inventory principle); the losing re-rolls are named per entry below.
 */
import type { Size3D } from '../../model/types'
import type { CatalogEntry } from '../types'

/**
 * Corrections document §8: "a scale of ×2.5 for all the chandeliers". It is a
 * property of the catalogue rather than of any one fixture, so it is stated once
 * and every `defaultSize` is derived from the file's own bounds — the ratio the
 * loader fits by can then never disagree with the number the plan draws.
 * ×2.5 lands exactly on all ten measurements below in binary floating point, so
 * nothing here needs rounding.
 */
const CATALOG_SCALE = 2.5

const scaled = (s: Size3D): Size3D => ({
  width: s.width * CATALOG_SCALE,
  depth: s.depth * CATALOG_SCALE,
  height: s.height * CATALOG_SCALE,
})

function ceilingProp(
  id: string,
  labelKey: string,
  /** what the item looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  model: string,
  /** the EXACT bounds glb-prep normalised the file to; `defaultSize` is this ×2.5 */
  modelSize: Size3D,
  color: string,
  shape: 'round' | 'rect' = 'round',
  /** fraction of the drop occupied by the fixture body — the rest is cord/chain */
  bodyFraction = 0.35,
  /** where in the hall this fixture may hang; absent = anywhere over the floor */
  siting?: Pick<CatalogEntry, 'allowedZones'>,
): CatalogEntry {
  return {
    id,
    category: 'lighting',
    labelKey,
    promptFragment,
    ...siting,
    defaultSize: scaled(modelSize),
    resizable: [],
    minSize: {},
    maxSize: {},
    linkWidthDepth: shape === 'round',
    placement: 'ceiling',
    // Source doc §20: no subtitle on any of the five 'lighting' fixtures. The
    // number that matters for something hanging in open air is the drop, and the
    // user sets that on the hang-height slider (§13) — the plan width decides
    // nothing, so printing it only makes the tile taller.
    librarySubtitle: 'none',
    // Library search, on the factory so all five fixtures share it. 'נברשת' and
    // 'מנורה' are the two nouns in real use for what hangs here, and 'תלייה' /
    // 'תקרה' are how someone describes the position rather than the object.
    keywords: ['תאורה', 'נברשת', 'מנורה', 'תלייה', 'תקרה', 'אור'],
    materialSlots: [{ name: 'body', labelKey: 'body', defaultColor: color }],
    footprint: (s) =>
      shape === 'round'
        ? {
            parts: [{ kind: 'circle', r: Math.max(s.width, s.depth) / 2, slot: 'body' }],
            outline: { kind: 'circle', r: Math.max(s.width, s.depth) / 2 },
          }
        : {
            parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 2, slot: 'body' }],
            outline: { kind: 'rect', w: s.width, h: s.depth },
          },
    // Fallback only (the GLB is the real render): the body sits at the BOTTOM of
    // the drop, since the object's origin is its lowest point and the cord runs
    // up from there to the ceiling.
    buildMesh: (s) => [
      {
        shape: 'cylinder',
        dims: [s.width / 2, s.width / 2, s.height * bodyFraction],
        offset: [0, (s.height * bodyFraction) / 2, 0],
        slot: 'body',
      },
    ],
    model,
    modelSize,
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

const P = (file: string) => `/props/${file}`

// Each size below is the FILE's normalised bounds. The catalogued size is that
// ×2.5 (`CATALOG_SCALE`), which is the number the plan draws and the slider
// ranges against; the resulting drops are 125 · 150 · 225 · 275 · 300 cm.
export const hangingEntries: CatalogEntry[] = [
  // one slim lattice drum on a long cord — the cord is part of the drop, which
  // the file models at 50 cm and the catalogue reads as 125
  ceilingProp('lamp.pendant', 'lampPendant', 'a slim lattice drum pendant lamp on a long cord', P('decor-pendant-lamp.glb'), { width: 12.6, depth: 12.4, height: 50 }, '#cfb995'),
  // NOT one "geometric" pendant: the model is a CLUSTER OF FOUR of the same
  // lattice drums on staggered cords (verified by render, 2026-07-20) — which is
  // why it is 42.6 deep in the file. The longest cord defines the drop: 60 cm
  // modelled, 150 catalogued.
  //
  // Source doc §29: "in the lighting layouts, lamp clusters can only be placed
  // above the bar." `within: 0` is the bar rectangle itself, touching included —
  // the zone IS the rule, so no clearance is invented. It is the only one of the
  // five fixtures that is sited; the rest hang anywhere over the floor.
  //
  // ⚠ `allowedZones` and NOT `zoneKind`, and the difference is invisible until it
  // bites. `clampToVenue`'s home-zone branch (state/actions.ts:379-415) ends in a
  // `continue`, BEFORE the ceiling branch that pins a fixture to the truss
  // lattice (:422). Give a ceiling entry a `zoneKind` and it stops snapping to
  // the beams, silently, and hangs in mid-air between them — there is no ceiling
  // entry with a `zoneKind` today, which is why nothing catches it.
  ceilingProp('lamp.pendant-cluster', 'lampPendantCluster', 'a cluster of four lattice drum pendant lamps on staggered cords', P('decor-pendant-geometric.glb'), { width: 18.1, depth: 42.6, height: 60 }, '#d4c5aa', 'rect', 0.35, { allowedZones: [{ kind: 'bar', within: 0 }] }),
  // --- chandeliers (2026-07-20) ---
  // Beaded crystal rhombus on a bare cord. 42% of the drop is cord (measured),
  // so the catalogued 225 cm hangs a ~130 cm diamond, 120 cm across, about a
  // metre below the truss.
  // Losing re-roll: "crystal+chandelier+3d+model (1).glb" — same product, but a
  // flatter diamond with coarse irregular beading; (5) matches the photos.
  ceilingProp('lamp.chandelier-diamond', 'lampChandelierDiamond', 'a beaded crystal rhombus chandelier on a bare cord', P('decor-chandelier-diamond.glb'), { width: 48.1, depth: 48.2, height: 90 }, '#ad9e84', 'round', 0.55),
  // Brass empire basket: beaded column, two tiers of candle arms, beaded bowl.
  // The column is part of the fixture (it stays ~8 cm wide in the file, 20 cm
  // catalogued, the whole way down), so the full drop is the piece, not a
  // length of chain: 110 cm modelled, 275 catalogued.
  // Losing re-rolls: "(3)" (thinner column) and "chandelier+3d+model.glb"
  // (dropped a whole candle tier and the column beading).
  ceilingProp('lamp.chandelier-basket', 'lampChandelierBasket', 'a brass empire basket chandelier with a beaded column and two tiers of candle arms', P('decor-chandelier-basket.glb'), { width: 54.7, depth: 57.1, height: 110 }, '#b8a383', 'round', 0.40),
  // Grand chrome candelabra, two concentric rings of candles under a scrolled
  // upper tier, and the biggest thing that hangs: body is 85% of the bbox (short
  // chain only), so the catalogued 300 cm is a ~255 cm fixture, 229 cm across.
  // Losing re-roll: "crystal+chandelier+3d+model.glb" — one candle ring instead
  // of the product's two.
  ceilingProp('lamp.chandelier-candelabra', 'lampChandelierCandelabra', 'a grand chrome candelabra chandelier with two concentric rings of candles', P('decor-chandelier-candelabra.glb'), { width: 91.7, depth: 91.7, height: 120 }, '#999895', 'round', 0.85),
]
