/**
 * Real table-top decor of the resort venue (phase 2.5): Tripo GLBs normalised by
 * glb-prep --mode prop (uniform scale to a sensible default height — proportions
 * preserved), sizes below are the EXACT normalised bounds, so 2D footprint,
 * 3D fit and clamping all agree. placement:'surface' means the item can only be
 * dropped onto a table and lives as an attached child on the table's top.
 * Materials are baked (see propModel.ts) — the single slot colours the 2D shape.
 */
import type { Size3D } from '../../model/types'
import type { CatalogEntry } from '../types'

function surfaceProp(
  id: string,
  labelKey: string,
  model: string,
  size: Size3D,
  color: string,
  shape: 'round' | 'rect' = 'round',
): CatalogEntry {
  return {
    id,
    category: 'tableDecor',
    labelKey,
    defaultSize: size,
    resizable: [],
    minSize: {},
    maxSize: {},
    linkWidthDepth: shape === 'round',
    placement: 'surface',
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
    buildMesh: (s) =>
      shape === 'round'
        ? [
            {
              shape: 'cylinder',
              dims: [s.width * 0.35, s.width * 0.45, s.height],
              offset: [0, s.height / 2, 0],
              slot: 'body',
            },
          ]
        : [{ shape: 'box', dims: [s.width, s.height, s.depth], offset: [0, s.height / 2, 0], slot: 'body' }],
    model,
    // product shot (tools/thumbs-prep.mjs naming); LibraryPanel falls back to the
    // vector top-view if the file is absent
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
  }
}

const P = (file: string) => `/props/${file}`

export const tableDecorEntries: CatalogEntry[] = [
  surfaceProp('decor.candlestick-brass', 'decorCandlestickBrass', P('decor-candlestick-brass.glb'), { width: 21.4, depth: 21.4, height: 35 }, '#a8823f'),
  surfaceProp('decor.vase-ceramic', 'decorVaseCeramic', P('decor-vase-ceramic.glb'), { width: 17.5, depth: 23.7, height: 35 }, '#b8afa3'),
  // NOT goblets: the Tripo model is a PAIR of cut-crystal vases (verified against
  // the product shot, 2026-07-19) — sized as vases, id kept to avoid churn
  surfaceProp('decor.goblet-crystal', 'decorGobletCrystal', P('decor-goblet-crystal.glb'), { width: 35, depth: 18.7, height: 35 }, '#dbe4ea', 'rect'),
  surfaceProp('decor.candelabra-crystal', 'decorCandelabraCrystal', P('decor-candelabra-crystal.glb'), { width: 23.9, depth: 31.1, height: 55 }, '#cfd8e3'),
  // a ROW of slim crystal holders (one mesh, seen end-on in renders)
  surfaceProp('decor.candleholder-crystal-a', 'decorCandleholderCrystalA', P('decor-candleholder-crystal-a.glb'), { width: 9.5, depth: 28.8, height: 30 }, '#d8e0e8', 'rect'),
  // NOT a small holder: a full crystal candelabra with hanging prisms (verified)
  surfaceProp('decor.candleholder-crystal-b', 'decorCandleholderCrystalB', P('decor-candleholder-crystal-b.glb'), { width: 20.3, depth: 22.6, height: 50 }, '#d8e0e8'),
  surfaceProp('decor.vases-decorative', 'decorVasesDecorative', P('decor-vases-decorative.glb'), { width: 29, depth: 31.6, height: 40 }, '#9b8e7e'),
  surfaceProp('decor.vase-flowers-a', 'decorVaseFlowersA', P('decor-vase-flowers-a.glb'), { width: 10.9, depth: 42, height: 45 }, '#c98ba0', 'rect'),
  surfaceProp('decor.vase-flowers-b', 'decorVaseFlowersB', P('decor-vase-flowers-b.glb'), { width: 16.9, depth: 19.1, height: 45 }, '#c98ba0'),
  surfaceProp('decor.fabric-folded', 'decorFabricFolded', P('decor-fabric-folded.glb'), { width: 6, depth: 10.8, height: 12 }, '#e8e2d8', 'rect'),
  surfaceProp('decor.napkin-folded', 'decorNapkinFolded', P('decor-napkin-folded.glb'), { width: 12.2, depth: 30.8, height: 10 }, '#f0ece4', 'rect'),
  surfaceProp('decor.candleholders-glass', 'decorCandleholdersGlass', P('decor-candleholders-glass.glb'), { width: 5.4, depth: 29.4, height: 20 }, '#ccd6da', 'rect'),
  surfaceProp('decor.candelabrum-gold', 'decorCandelabrumGold', P('decor-candelabrum-gold.glb'), { width: 30.3, depth: 36.8, height: 55 }, '#c9a86a'),
  surfaceProp('decor.candlestick-gold', 'decorCandlestickGold', P('decor-candlestick-gold.glb'), { width: 6.1, depth: 12.5, height: 40 }, '#c9a86a'),
  surfaceProp('decor.vases-gold-striped', 'decorVasesGoldStriped', P('decor-vases-gold-striped.glb'), { width: 10.3, depth: 22.4, height: 38 }, '#c2a25e', 'rect'),
  surfaceProp('decor.candelabrum-golden', 'decorCandelabrumGolden', P('decor-candelabrum-golden.glb'), { width: 22.6, depth: 23.9, height: 55 }, '#c9a86a'),
  surfaceProp('decor.topiary-green', 'decorTopiaryGreen', P('decor-topiary-green.glb'), { width: 32.7, depth: 30.9, height: 45 }, '#5f7f4f'),
  surfaceProp('decor.vase-pampas', 'decorVasePampas', P('decor-vase-pampas.glb'), { width: 52.7, depth: 61.4, height: 70 }, '#cbb694'),
  surfaceProp('decor.tulips-pink', 'decorTulipsPink', P('decor-tulips-pink.glb'), { width: 38.7, depth: 39.1, height: 40 }, '#d78ba3'),
  surfaceProp('decor.bouquet-roses', 'decorBouquetRoses', P('decor-bouquet-roses.glb'), { width: 33.2, depth: 34.8, height: 40 }, '#c46a79'),
  surfaceProp('decor.vases-rose-gold', 'decorVasesRoseGold', P('decor-vases-rose-gold.glb'), { width: 51.9, depth: 71.7, height: 38 }, '#d2a08a', 'rect'),
  surfaceProp('decor.vase-striped', 'decorVaseStriped', P('decor-vase-striped.glb'), { width: 17.9, depth: 18.9, height: 35 }, '#8f8a80'),
  surfaceProp('decor.vases-white-ceramic', 'decorVasesWhiteCeramic', P('decor-vases-white-ceramic.glb'), { width: 28.4, depth: 33.6, height: 35 }, '#e9e5dd'),
  surfaceProp('decor.napkin-white', 'decorNapkinWhite', P('decor-napkin-white.glb'), { width: 8.6, depth: 5.4, height: 8 }, '#f3f0ea', 'rect'),
  surfaceProp('decor.candleholders-wood', 'decorCandleholdersWood', P('decor-candleholders-wood.glb'), { width: 5.3, depth: 21.1, height: 25 }, '#8a6b4f', 'rect'),
  surfaceProp('decor.candlestick-wood', 'decorCandlestickWood', P('decor-candlestick-wood.glb'), { width: 6.3, depth: 25.1, height: 30 }, '#8a6b4f', 'rect'),
  // The only 'seat'-placement entry: dropping it on a table lays one out in front
  // of EVERY chair (see core/layout/seatItemLayout.ts) instead of one at the pointer.
  // 45×33 is the cover the venue actually lays; the 15.9 height is the wine glass,
  // the tallest of the model's 9 meshes — footprint was resized, height was not.
  {
    ...surfaceProp('decor.place-setting', 'decorPlaceSetting', P('decor-place-setting.glb'), { width: 45, depth: 33, height: 15.9 }, '#d9d4cb', 'rect'),
    placement: 'seat',
  },
]
