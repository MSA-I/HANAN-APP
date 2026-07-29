/**
 * "עיצובי חופה" — the pieces that dress the ceremony spot around the canopy.
 * New in schema v9.
 *
 * Source model: HANAN-APP-DOCS\מודלים GLB\חופות\קישוטי חופות\ — a Tripo GLB
 * normalised by glb-prep --mode prop. Sizes are A1's measured prepped bounds
 * (handoff/02-a1-measurements.md).
 *
 * Two decisions this group turns on, both easy to get backwards:
 *
 * `placement: 'floor'`, NOT 'surface'. A chuppah decoration stands on the ground
 * beside the canopy; it is not table decor. That makes it a top-level object with
 * its own position rather than an attached child of anything.
 *
 * `zoneKind: 'chuppah'`, the same string the eight canopies carry. The venue pack
 * marks one 760×425 rectangle as the ceremony spot, and `clampToVenue` teleports a
 * matching object INTO the nearest such zone on drop and never lets it be dragged
 * out (entries/chuppah.ts's header). ⚠ The string is compared as a STRING: a typo
 * does not degrade to "places freely", it makes the object get pushed OUT of every
 * restricted zone instead (layout/collision.ts:456). It is copied character for
 * character from entries/chuppah.ts.
 *
 * Deliberately NOT `unique`. The canopies all carry `unique: 'chuppah'` so that
 * placing any one blocks the other eight — one ceremony, one canopy. Decorations
 * are the opposite case: the whole point is to stand several of them around the
 * spot, so the tag is absent and stays absent.
 */
import type { CatalogEntry } from '../types'

const P = (file: string) => `/props/${file}`

/**
 * One floor-standing ceremony decoration. Materials are baked into the GLB (see
 * viewer3d/propModel.ts), so the single slot only colours the 2D footprint and the
 * procedural fallback; its value is the model's measured mean base colour.
 */
function chuppahDecorProp(
  id: string,
  labelKey: string,
  /** what the item looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  model: string,
  size: { width: number; depth: number; height: number },
  color: string,
): CatalogEntry {
  return {
    id,
    category: 'chuppahDecor',
    labelKey,
    promptFragment,
    defaultSize: size,
    resizable: [],
    minSize: {},
    maxSize: {},
    // Source doc §20: no subtitle on 'chuppahDecor' — a ceremony decoration is
    // picked by look, and the zone clamp decides where it goes, not its width.
    // The canopies it stands beside (entries/chuppah.ts) keep the default 'size':
    // a 3.5 m structure has to be checked against the ceremony spot.
    librarySubtitle: 'none',
    materialSlots: [{ name: 'body', labelKey: 'body', defaultColor: color }],
    footprint: (s) => ({
      parts: [{ kind: 'rect', w: s.width, h: s.depth, cornerRadius: 3, slot: 'body' }],
      outline: { kind: 'rect', w: s.width, h: s.depth },
    }),
    // Fallback only (the GLB is the real render): a single tapered mass, which is
    // all the silhouette a floral/foliage arrangement reads as in plan.
    buildMesh: (s) => [
      {
        shape: 'cylinder',
        dims: [s.width * 0.4, s.width * 0.25, s.height],
        offset: [0, s.height / 2, 0],
        slot: 'body',
      },
    ],
    model,
    thumbnail: `/thumbs/${id.replaceAll('.', '-')}.webp`,
    // ⚠ The AISLE, not the ceremony pad. The user painted ZONE_SHVIL_HUPA on
    // 2026-07-29 and said in as many words that it is where the chuppah
    // decorations go; before it existed they shared the canopy's own rectangle
    // because there was nowhere else to put them. The canopy keeps `chuppah` —
    // one ceremony, one canopy, on its podium — and what dresses the walk up to
    // it now has its own ground.
    zoneKind: 'shvilHupa',
  }
}

export const chuppahDecorEntries: CatalogEntry[] = [
  // ⚠ The rods are CLEAR ACRYLIC, not chrome. They render grey in a rasterised
  // preview because glb-prep drops KHR_materials_volume and the transmission
  // never survives the prep (A1, handoff/02-a1-measurements.md §6) — the product
  // shot settles it, same material family as `chuppah.acrylic`.
  //
  // The 140 cm height is CHOSEN, not measured: Tripo normalises to a unit box, so
  // the source carries proportion only and no scale. 140 puts the hydrangea ball
  // at eye level beside a 3.24 m chuppah. The footprint is measured.
  chuppahDecorProp('chuppah.decor-1', 'chuppahDecor1',
    'a tall clear-acrylic four-rod column on a square base, topped by a dense ball of white hydrangea',
    P('chuppah-decor-1.glb'), { width: 52.6, depth: 61.1, height: 140 }, '#c3c3b3'),
]
