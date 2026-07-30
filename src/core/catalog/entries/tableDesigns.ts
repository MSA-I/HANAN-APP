/**
 * "עיצובי שולחן" — the sculptural centrepieces the venue drops onto a dressed
 * table as a finished look, as opposed to the individual pieces a look is built
 * from (entries/tableDecor.ts). New in schema v9.
 *
 * Source models: HANAN-APP-DOCS\מודלים GLB\עיצובי שולחן\ — four Tripo GLBs
 * normalised by glb-prep --mode prop. Sizes below are the EXACT prepped bounds,
 * so the 2D footprint, the 3D fit and the surface clamp all agree; they come from
 * A1's measurements (handoff/02-a1-measurements.md), never from the plan.
 *
 * They are built by `surfaceProp`, imported from entries/tableDecor.ts and spread
 * with a different `category` — the recipe is identical and that file already uses
 * the same override for its own 'tableware' entries. Sharing the one function beats
 * a third copy of the footprint/mesh pair; giving the group its own FILE (rather
 * than a third category inside tableDecor.ts, which already carries two) is what
 * keeps both readable.
 *
 * `surfaceAnchor: 'center'` on all three — source doc §54: a design placed by hand
 * belongs in the middle of the table, not wherever the pointer was. It binds hand
 * placement only; a saved design lays its own arrangement, which is the point of a
 * design.
 *
 * ✅ Gate 1 of handoff/BLOCKED-02-A2.md is CLOSED. The fourth product photo now has
 * its model — it was saved hours after that gate was written, under a name with a
 * typo. Four photos, four models, four entries.
 *
 * ⛔ Gate 2 is still open: source doc line 75 says some existing decor MOVED into
 * this group. It names no items, and the category it names ("עיצובי בסיס") does not
 * exist in the code. Nothing was moved: a category move orphans `settings.layers`
 * in every saved project, so it needs the user's list, not a guess.
 */
import { surfaceProp } from './tableDecor'
import type { CatalogEntry } from '../types'

const P = (file: string) => `/props/${file}`

/**
 * The same recipe as table decor, filed under the design category.
 *
 * `keywords` rides through the spread from `surfaceProp`, so every design
 * already answers to SURFACE_KEYWORDS plus whatever its own call passes as the
 * last argument.
 */
function design(...args: Parameters<typeof surfaceProp>): CatalogEntry {
  return { ...surfaceProp(...args), category: 'tableDesigns' }
}

export const tableDesignEntries: CatalogEntry[] = [
  // Two tiers of scrolled arms carrying twelve candle cups plus one on the centre
  // stem — thirteen lights — on a slim fluted column and a stepped faceted foot.
  // Identified against product shot hf_20260728_112931: the model has OPEN candle
  // cups and a faceted foot, which is what separates it from the fourth photo
  // (hf_20260728_113310), a different candelabrum whose every candle stands in a
  // tall glass hurricane chimney and whose foot is a plain round disc. That photo
  // has no model — ⛔ gate 1. The 75 cm height puts this tier above the 55 cm
  // `decor.candelabra-crystal`; these are the statement pieces.
  design('design.candelabrum-crystal', 'designCandelabrumCrystal',
    'a thirteen-light crystal candelabrum, two tiers of scrolled arms on a fluted column',
    P('design-candelabrum-crystal.glb'), { width: 37.2, depth: 39.5, height: 75 }, '#969b96',
    'round', ['נר', 'נרות', 'פמוט', 'קנדלברה', 'קריסטל']),
  // Six slim glass rods at three heights rising from ONE square mirrored base —
  // rect, because that base is square and a disc would misdraw it. Each rod wears
  // a dark collar under a faceted flame finial. ⚠ It reads as solid glass in 3D:
  // glb-prep drops KHR_materials_volume, so the transmission never survives the
  // prep (A1, handoff/02-a1-measurements.md §6) — long-standing pipeline
  // behaviour, not something this entry introduced.
  design('design.lamp-glass-rod', 'designLampGlassRod',
    'a cluster of six slim glass candle rods at staggered heights on one mirrored base',
    P('design-lamp-glass-rod.glb'), { width: 20.8, depth: 20, height: 70 }, '#b5b4b3', 'rect',
    ['נר', 'נרות', 'זכוכית', 'מוט']),
  // Three white phalaenopsis stems with long trailing leaves, held in a tall
  // three-rod brass frame on a round brass base plate. The measured mean is warm
  // and olive rather than white because the brass and the leaves cover more area
  // than the flowers do.
  design('design.orchid-sculpture', 'designOrchidSculpture',
    'three white orchid stems with trailing leaves in a tall brass rod frame',
    P('design-orchid-sculpture.glb'), { width: 26.4, depth: 26.3, height: 80 }, '#b5b191',
    'round', ['פרחים', 'פרח', 'סחלב', 'פליז']),
  // The fourth product shot, hf_20260728_113310, which gate 1 above reported as
  // having no model: the model arrived at 19:07 that evening, named
  // "crystal candelabrum 3d mode3l.glb" — the typo is why it does not read as a
  // second copy of the file behind `design.candelabrum-crystal`.
  //
  // Identified by render, not by name. It is the OTHER 13-light two-tier
  // candelabrum, and the two are separable on exactly the features the gate named:
  // this one is all glass, its arms are scrolled S-curves, every candle stands in
  // a tall cylindrical chimney and it rises from a plain round glass disc; the
  // crystal one has open cups, plain C-arms, a fluted column and a stepped faceted
  // foot. Both match their own photo feature for feature.
  //
  // ⚠ 85 is a CHOSEN height, on the same footing as the three above (see
  // 02-a1-measurements.md "Why those heights") — Tripo normalises every source to
  // ~0.98 so the file carries no real scale. It is the tallest of the four because
  // the chimneys stand above the candle cups, and it lands the footprint at
  // 25.9 × 26.3, in line with the orchid's 26.4 × 26.3. Width and depth are NOT
  // chosen: they are the exact prepped bounds that the height implies.
  design('design.candelabrum-hurricane', 'designCandelabrumHurricane',
    'a thirteen-light glass candelabrum, each candle inside a tall glass chimney, on scrolled glass arms',
    P('design-candelabrum-hurricane.glb'), { width: 25.9, depth: 26.3, height: 85 }, '#cecdc8',
    'round', ['נר', 'נרות', 'פמוט', 'קנדלברה', 'זכוכית']),
]
