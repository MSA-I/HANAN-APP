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
 * The GLBs are Tripo models normalised by glb-prep --mode prop. The three
 * CHANDELIERS are catalogued at 2.5× their normalised bounds (corrections
 * document §8: "a scale of ×2.5 for all the chandeliers") and the two PENDANTS at
 * 6.25× — the ×2.5 again, applied a second time on those two alone (round-4
 * item 14a). The venue's real fixtures read far larger in an 11.6 m hall than the
 * Tripo exports do, and the drum pendants were the two that still read as toys.
 * The files are NOT re-prepped, so each entry states its `modelSize` (the bounds
 * glb-prep actually wrote) and the loader grows the model by `size / modelSize`;
 * without it the ratio would be 1 and the 3D fixture would silently stay small
 * while the 2D footprint grew.
 * Those bounds are MEASURED, not merely declared — all five files were re-read
 * vertex by vertex on 2026-07-28 and agree to within 0.4 mm (Draco quantisation;
 * see handoff/FOUND-03.md §A1-1, and FOUND-02.md §A3-1 for the round-1 case
 * where an entry and its file HAD drifted apart unnoticed).
 * Materials are baked (see propModel.ts) — the single slot only colours the 2D
 * shape, and its value is the model's measured mean base colour, not a guess.
 *
 * ⚠ `height` feeds `hangRange` (layout/beams.ts), so every rescale eats headroom.
 * In the resort (roof 1160, truss 895, MAX_DROP_FROM_CEILING 650) the band is
 * [max(0, 510 − height), 895 − height]: it is 385 cm wide whatever the fixture,
 * because both ends move together, and it only starts to narrow once height
 * passes 510. The tallest here is now the 375 cm cluster, so all five still keep
 * the full slider — but the margin is 135 cm, not the 210 it was before ×6.25.
 * Pinned in hanging.test.ts; the original figures are in handoff/03-sizes.md.
 *
 * ⚠ In a PROCEDURAL room the two pendants no longer fit. `DEFAULT_WALL_HEIGHT` is
 * 350 and `factory.createObject` seeds `wallHeight − height` WITHOUT clamping
 * (model/factory.ts:155-157), so a 375 cm cluster seeds at −25: below the floor.
 * Nothing ships broken — the only pack is the resort at 1160/895 — but this is
 * the first entry in the catalogue whose default does not fit the default room,
 * and hanging.test.ts states it so it cannot be met by surprise.
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
 *
 * ⚠ The claim that used to stand here — "×2.5 lands exactly on all ten
 * measurements in binary floating point" — was true, and is no longer, because it
 * was never a property of 2.5. Round-4 item 14a puts the two drum pendants at
 * ×6.25 as well, and 18.1 × 6.25 = 113.12500000000001: 25/4 is exact, but 18.1 is
 * not a double, and the product's nearest double is one ulp above 113.125. The
 * error is 1.4 × 10⁻¹⁴ cm, so nothing is rounded or written out as a literal —
 * the derivation stays the single source, exactly as before, and the ONE test
 * that has to compare against a decimal uses `toBeCloseTo`.
 */
const CATALOG_SCALE = 2.5

/**
 * Round-4 item 14a: the same ×2.5 again, on `lamp.pendant` and
 * `lamp.pendant-cluster` only. They are single lattice drums, 12.6 and 18.1 cm in
 * the file, and at ×2.5 they read as tea-lights in an 11.6 m hall — 31 cm across,
 * with a 1.25 m drop. The three chandeliers stay at ×2.5; they were already the
 * right size. This is why the two scales are named separately instead of one
 * constant being edited: they are two different decisions about two families.
 */
const PENDANT_SCALE = CATALOG_SCALE * 2.5

const scaled = (s: Size3D, scale: number): Size3D => ({
  width: s.width * scale,
  depth: s.depth * scale,
  height: s.height * scale,
})

/**
 * The trailing arguments are an options object rather than five more positionals:
 * with `shape`, `bodyFraction` and `siting` all optional and defaulted, a sixth
 * would have made the cluster's call site four values deep in un-named literals.
 */
interface CeilingPropOptions {
  /** multiplier from the file's bounds to the catalogued size */
  scale?: number
  shape?: 'round' | 'rect'
  /** fraction of the drop occupied by the fixture body — the rest is cord/chain */
  bodyFraction?: number
  /** where in the hall this fixture may hang; absent = anywhere over the floor */
  siting?: Pick<CatalogEntry, 'allowedZones'>
  /** MEASURED cord positions as fractions of the bounds — see CatalogEntry.cordAnchors */
  cordAnchors?: CatalogEntry['cordAnchors']
}

function ceilingProp(
  id: string,
  labelKey: string,
  /** what the item looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  model: string,
  /** the EXACT bounds glb-prep normalised the file to; `defaultSize` is this × `scale` */
  modelSize: Size3D,
  color: string,
  {
    scale = CATALOG_SCALE,
    shape = 'round',
    bodyFraction = 0.35,
    siting,
    cordAnchors,
  }: CeilingPropOptions = {},
): CatalogEntry {
  return {
    ...(cordAnchors ? { cordAnchors } : {}),
    id,
    category: 'lighting',
    labelKey,
    promptFragment,
    ...siting,
    defaultSize: scaled(modelSize, scale),
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
// × the entry's scale — `PENDANT_SCALE` (6.25) for the two drum pendants,
// `CATALOG_SCALE` (2.5) for the three chandeliers — which is the number the plan
// draws and the slider ranges against; the resulting drops are
// 312.5 · 375 · 225 · 275 · 300 cm. The two pendants are now the TALLEST things
// that hang, which is a reversal: they used to be the two shortest.
export const hangingEntries: CatalogEntry[] = [
  // one slim lattice drum on a long cord — the cord is part of the drop, which
  // the file models at 50 cm and the catalogue reads as 312.5 (78.75 × 77.5 across)
  //
  // No `cordAnchors`, and that is a measurement rather than an omission: the file
  // holds ONE drum on ONE cord standing 0.2 mm off the axis, and its cord reaches
  // the very top of the bbox. Absent anchors mean exactly one cord on the axis, so
  // declaring { x: 0, y: 0 } would say the same thing twice.
  //   node tools/glb-prep/measure-cord-anchors.mjs \
  //        public/props/decor-pendant-lamp.glb --expect 1
  ceilingProp('lamp.pendant', 'lampPendant', 'a slim lattice drum pendant lamp on a long cord', P('decor-pendant-lamp.glb'), { width: 12.6, depth: 12.4, height: 50 }, '#cfb995', { scale: PENDANT_SCALE }),
  // NOT one "geometric" pendant: the model is a CLUSTER OF FOUR of the same
  // lattice drums on staggered cords (verified by render, 2026-07-20) — which is
  // why it is 42.6 deep in the file. The longest cord defines the drop: 60 cm
  // modelled, 375 catalogued (113.125 × 266.25 across).
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
  //
  // ⚠ THE FOUR NUMBERS BELOW ARE MEASURED, NOT LAID OUT. `inspect-parts.mjs`
  // cannot see them — this file has ONE material for the whole cluster, so it
  // reports 1 part and 35,728 tris and can say nothing about where the drums are.
  // They come from the geometry, via a tool written for it:
  //
  //   node tools/glb-prep/measure-cord-anchors.mjs \
  //        public/props/decor-pendant-geometric.glb --cord 33:38 --expect 4
  //
  // Four vertical columns in the band y 33-38, each under 0.7 cm across, with a
  // drum 8.4-12.6 cm wide standing under it — the tool assigns every vertex below
  // the band to its nearest column and the centroids agree to 1.15 cm at worst.
  // That agreement is the check, and it is why these are numbers and not a guess.
  // The bands are named on the command line rather than defaulted for a reason
  // given in the tool's header and repeated here, because it also bounds what
  // these anchors can fix:
  //
  // ⚠ THE FOUR CORDS ARE FOUR DIFFERENT LENGTHS, which is what `top` is for. They
  // reach 0.6897, 1.0000, 0.6426 and 0.6654 of the model's height — the entry name
  // says "staggered cords" and this is what that means. Only ONE touches the top of
  // the bbox, and the top of the bbox is the plane the procedural drop is measured
  // from, so drawing all four from there left three of them starting a third of the
  // model ABOVE where the file's own rod ends: three wires with clear air under
  // them. Each now starts at its own rod's top and is given that shortfall back on
  // top of the shared drop (`HangingCord`), so at the seeded elevation — where the
  // drop is zero and the tall one correctly draws nothing — the other three draw
  // exactly the gap the file leaves.
  //
  // The tops come from the same run as the anchors; the tool prints them under
  // "CORD TOPS". Re-measure with the command above after any re-prep.
  ceilingProp('lamp.pendant-cluster', 'lampPendantCluster', 'a cluster of four lattice drum pendant lamps on staggered cords', P('decor-pendant-geometric.glb'), { width: 18.1, depth: 42.6, height: 60 }, '#d4c5aa', {
    scale: PENDANT_SCALE,
    shape: 'rect',
    siting: { allowedZones: [{ kind: 'bar', within: 0 }] },
    cordAnchors: [
      { x: 0.1445, y: -0.3517, top: 0.6897 },
      { x: 0.1176, y: -0.0574, top: 1 },
      { x: -0.3212, y: 0.0799, top: 0.6426 },
      { x: 0.1285, y: 0.3545, top: 0.6654 },
    ],
  }),
  // --- chandeliers (2026-07-20) ---
  // Beaded crystal rhombus on a bare cord. 42% of the drop is cord (measured),
  // so the catalogued 225 cm hangs a ~130 cm diamond, 120 cm across, about a
  // metre below the truss.
  // Losing re-roll: "crystal+chandelier+3d+model (1).glb" — same product, but a
  // flatter diamond with coarse irregular beading; (5) matches the photos.
  ceilingProp('lamp.chandelier-diamond', 'lampChandelierDiamond', 'a beaded crystal rhombus chandelier on a bare cord', P('decor-chandelier-diamond.glb'), { width: 48.1, depth: 48.2, height: 90 }, '#ad9e84', { bodyFraction: 0.55 }),
  // Brass empire basket: beaded column, two tiers of candle arms, beaded bowl.
  // The column is part of the fixture (it stays ~8 cm wide in the file, 20 cm
  // catalogued, the whole way down), so the full drop is the piece, not a
  // length of chain: 110 cm modelled, 275 catalogued.
  // Losing re-rolls: "(3)" (thinner column) and "chandelier+3d+model.glb"
  // (dropped a whole candle tier and the column beading).
  ceilingProp('lamp.chandelier-basket', 'lampChandelierBasket', 'a brass empire basket chandelier with a beaded column and two tiers of candle arms', P('decor-chandelier-basket.glb'), { width: 54.7, depth: 57.1, height: 110 }, '#b8a383', { bodyFraction: 0.40 }),
  // Grand chrome candelabra, two concentric rings of candles under a scrolled
  // upper tier, and the biggest single BODY that hangs: 85% of the bbox (short
  // chain only), so the catalogued 300 cm is a ~255 cm fixture, 229 cm across.
  // ⚠ No longer the tallest fixture, nor the widest footprint — ×6.25 gave the
  // cluster a 375 cm drop over 113 × 266 of plan. It is four small drums spread
  // out, though; this is still the largest thing in the room.
  // Losing re-roll: "crystal+chandelier+3d+model.glb" — one candle ring instead
  // of the product's two.
  ceilingProp('lamp.chandelier-candelabra', 'lampChandelierCandelabra', 'a grand chrome candelabra chandelier with two concentric rings of candles', P('decor-chandelier-candelabra.glb'), { width: 91.7, depth: 91.7, height: 120 }, '#999895', { bodyFraction: 0.85 }),
]
