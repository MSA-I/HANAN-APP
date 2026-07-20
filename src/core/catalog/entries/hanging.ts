/**
 * Ceiling-hung decor (phase 2.6). placement:'ceiling' is what makes these
 * different from every other entry: they are still TOP-LEVEL objects (not
 * attached children like table decor), but factory.createObject seeds their
 * elevation to `venue.wallHeight − height` so the model's top meets the ceiling
 * and it hangs down — the drop length IS the entry height.
 *
 * The GLBs are Tripo models normalised by glb-prep --mode prop; sizes below are
 * the EXACT normalised bounds, so 2D footprint and 3D fit agree. Materials are
 * baked (see propModel.ts) — the single slot only colours the 2D shape, and its
 * value is the model's measured mean base colour, not a guess.
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

function ceilingProp(
  id: string,
  labelKey: string,
  model: string,
  size: Size3D,
  color: string,
  shape: 'round' | 'rect' = 'round',
  /** fraction of the drop occupied by the fixture body — the rest is cord/chain */
  bodyFraction = 0.35,
): CatalogEntry {
  return {
    id,
    category: 'decor',
    labelKey,
    defaultSize: size,
    resizable: [],
    minSize: {},
    maxSize: {},
    linkWidthDepth: shape === 'round',
    placement: 'ceiling',
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
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

const P = (file: string) => `/props/${file}`

export const hangingEntries: CatalogEntry[] = [
  // one slim lattice drum on a long cord — the cord is part of the 50 cm drop
  ceilingProp('lamp.pendant', 'lampPendant', P('decor-pendant-lamp.glb'), { width: 12.6, depth: 12.4, height: 50 }, '#cfb995'),
  // NOT one "geometric" pendant: the model is a CLUSTER OF FOUR of the same
  // lattice drums on staggered cords (verified by render, 2026-07-20) — which is
  // why it is 42.6 deep. The longest cord defines the 60 cm drop.
  ceilingProp('lamp.pendant-cluster', 'lampPendantCluster', P('decor-pendant-geometric.glb'), { width: 18.1, depth: 42.6, height: 60 }, '#d4c5aa', 'rect'),
  // --- chandeliers (2026-07-20) ---
  // Beaded crystal rhombus on a bare cord. 42% of the drop is cord (measured),
  // so 90 cm hangs a ~48 cm diamond about 40 cm below the ceiling.
  // Losing re-roll: "crystal+chandelier+3d+model (1).glb" — same product, but a
  // flatter diamond with coarse irregular beading; (5) matches the photos.
  ceilingProp('lamp.chandelier-diamond', 'lampChandelierDiamond', P('decor-chandelier-diamond.glb'), { width: 48.1, depth: 48.2, height: 90 }, '#ad9e84', 'round', 0.55),
  // Brass empire basket: beaded column, two tiers of candle arms, beaded bowl.
  // The column is part of the fixture (it stays ~8 cm wide the whole way down),
  // so the full 110 cm is the piece, not a drop length.
  // Losing re-rolls: "(3)" (thinner column) and "chandelier+3d+model.glb"
  // (dropped a whole candle tier and the column beading).
  ceilingProp('lamp.chandelier-basket', 'lampChandelierBasket', P('decor-chandelier-basket.glb'), { width: 54.7, depth: 57.1, height: 110 }, '#b8a383', 'round', 0.40),
  // Grand chrome candelabra, two concentric rings of candles under a scrolled
  // upper tier. Body is 85% of the bbox (short chain only), so 120 cm — the top
  // of the sensible range — still gives a ~102 cm fixture, 92 cm across.
  // Losing re-roll: "crystal+chandelier+3d+model.glb" — one candle ring instead
  // of the product's two.
  ceilingProp('lamp.chandelier-candelabra', 'lampChandelierCandelabra', P('decor-chandelier-candelabra.glb'), { width: 91.7, depth: 91.7, height: 120 }, '#999895', 'round', 0.85),
]
