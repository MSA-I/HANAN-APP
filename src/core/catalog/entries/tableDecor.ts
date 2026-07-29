/**
 * Real table-top decor of the resort venue (phase 2.5): Tripo GLBs normalised by
 * glb-prep --mode prop (uniform scale to a sensible default height — proportions
 * preserved), sizes below are the EXACT normalised bounds, so 2D footprint,
 * 3D fit and clamping all agree. placement:'surface' means the item can only be
 * dropped onto a table and lives as an attached child on the table's top.
 * Materials are baked (see propModel.ts) — the single slot colours the 2D shape.
 *
 * The file holds two categories. Most entries are 'tableDecor' — centrepieces,
 * the things that dress a table. Four are 'tableware': the place setting and the
 * three napkins, which are laid FOR a guest rather than arranged on the table, and
 * which the user picks per event. They stay here because they are built by the
 * same `surfaceProp` recipe; splitting the file would duplicate it.
 *
 * v9 added two MORE surface categories — 'tableDesigns' and 'ringCenter' — and
 * they got their own files rather than a third and fourth group in here, which
 * would have made this one unreadable. `surfaceProp` is exported instead, so the
 * recipe is shared without the entries being crowded together.
 */
import type { Size3D } from '../../model/types'
import type { CatalogEntry } from '../types'

/**
 * Exported for the two v9 table-top groups (entries/tableDesigns.ts,
 * entries/ringCenter.ts), which are the same recipe under a different category —
 * they spread the result and override `category`, exactly as `napkin()` and
 * `decor.place-setting` below do for 'tableware'. One `export` keyword beats
 * copying fifty lines of footprint/mesh into two more files, and it leaves this
 * file's own structure untouched.
 */
export function surfaceProp(
  id: string,
  labelKey: string,
  /** what the item looks like, for the image prompt — see CatalogEntry.promptFragment */
  promptFragment: string,
  model: string,
  size: Size3D,
  color: string,
  shape: 'round' | 'rect' = 'round',
): CatalogEntry {
  return {
    id,
    category: 'tableDecor',
    labelKey,
    promptFragment,
    defaultSize: size,
    resizable: [],
    minSize: {},
    maxSize: {},
    linkWidthDepth: shape === 'round',
    placement: 'surface',
    // Source doc §28: a centrepiece dropped by hand belongs in the middle of the
    // table, not wherever the pointer was. It binds hand placement only — a
    // built-in or saved design lays its own arrangement, which is the whole point
    // of a design (see clampToSurface). The three 'tableware' entries below opt
    // out: they are laid per seat, not on the centre.
    surfaceAnchor: 'center',
    // Source doc §20: "most of the items in the library do not even need
    // dimensions" — a centrepiece is chosen by look, not by its width. Declared on
    // the recipe, so it reaches all FOUR surface families built from it:
    // 'tableDecor' and 'tableware' in this file, plus 'tableDesigns' and
    // 'ringCenter', which spread this result and override only `category`.
    librarySubtitle: 'none',
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

/**
 * One of the three napkins: 'tableware', and recoloured with a FREE colour picker
 * rather than the fixed event palette every other editable slot offers — the
 * napkin is matched to the linen of the day, which is not a house colour.
 * `allowCustomColor` rides on the slot so the inspector widens exactly this one
 * control (ui/fields.tsx) and nothing else.
 */
function napkin(entry: CatalogEntry): CatalogEntry {
  return {
    ...entry,
    category: 'tableware',
    editableColorSlot: 'body',
    // A napkin is laid ON the place setting, never on the bare cloth (source doc
    // §27). That makes it a 'seat' item like the setting itself: one drop dresses
    // every cover, and each napkin is pinned to the setting it stands on, so
    // removing the settings takes the napkins with them.
    placement: 'seat',
    requiresHost: 'decor.place-setting',
    surfaceAnchor: 'free', // laid per cover, so §28's centre lock does not apply
    materialSlots: entry.materialSlots.map((slot) =>
      slot.name === 'body' ? { ...slot, allowCustomColor: true } : slot,
    ),
  }
}

export const tableDecorEntries: CatalogEntry[] = [
  surfaceProp('decor.candlestick-brass', 'decorCandlestickBrass', 'a brass candlestick', P('decor-candlestick-brass.glb'), { width: 21.4, depth: 21.4, height: 35 }, '#a8823f'),
  surfaceProp('decor.vase-ceramic', 'decorVaseCeramic', 'a matte ceramic vase', P('decor-vase-ceramic.glb'), { width: 17.5, depth: 23.7, height: 35 }, '#b8afa3'),
  // NOT goblets: the Tripo model is a PAIR of cut-crystal vases (verified against
  // the product shot, 2026-07-19) — sized as vases, id kept to avoid churn
  surfaceProp('decor.goblet-crystal', 'decorGobletCrystal', 'a pair of cut-crystal vases', P('decor-goblet-crystal.glb'), { width: 35, depth: 18.7, height: 35 }, '#dbe4ea', 'rect'),
  surfaceProp('decor.candelabra-crystal', 'decorCandelabraCrystal', 'a crystal candelabra', P('decor-candelabra-crystal.glb'), { width: 23.9, depth: 31.1, height: 55 }, '#cfd8e3'),
  // a ROW of slim crystal holders (one mesh, seen end-on in renders)
  surfaceProp('decor.candleholder-crystal-a', 'decorCandleholderCrystalA', 'a row of slim crystal candle holders', P('decor-candleholder-crystal-a.glb'), { width: 9.5, depth: 28.8, height: 30 }, '#d8e0e8', 'rect'),
  // NOT a small holder: a full crystal candelabra with hanging prisms (verified)
  surfaceProp('decor.candleholder-crystal-b', 'decorCandleholderCrystalB', 'a crystal candelabra hung with cut prisms', P('decor-candleholder-crystal-b.glb'), { width: 20.3, depth: 22.6, height: 50 }, '#d8e0e8'),
  surfaceProp('decor.vases-decorative', 'decorVasesDecorative', 'a cluster of decorative stoneware vases', P('decor-vases-decorative.glb'), { width: 29, depth: 31.6, height: 40 }, '#9b8e7e'),
  surfaceProp('decor.vase-flowers-a', 'decorVaseFlowersA', 'a tall narrow vase of pink flowers', P('decor-vase-flowers-a.glb'), { width: 10.9, depth: 42, height: 45 }, '#c98ba0', 'rect'),
  surfaceProp('decor.vase-flowers-b', 'decorVaseFlowersB', 'a rounded vase of pink flowers', P('decor-vase-flowers-b.glb'), { width: 16.9, depth: 19.1, height: 45 }, '#c98ba0'),
  // 'מפית מקופלת' — the label says napkin, the id and labelKey still say fabric.
  // They are stable identifiers (stored projects and thumbnail filenames key off
  // them), so only the visible string changed.
  napkin(surfaceProp('decor.fabric-folded', 'decorFabricFolded', 'a folded fabric napkin standing on the place setting', P('decor-fabric-folded.glb'), { width: 6, depth: 10.8, height: 12 }, '#e8e2d8', 'rect')),
  // 'קיפול מפית מגולגל' — source doc §14: the third napkin, which only ever got
  // the colour slot bolted on and so stayed a centrepiece. It goes through
  // napkin() like the other two, which is what makes it tableware, laid per cover
  // on the place setting, and recolourable to anything.
  // The id and the labelKey are STABLE IDENTIFIERS (stored projects and thumbnail
  // filenames key off them) — only the visible string in ui/strings.ts changed,
  // which is why an id and a labelKey that both read "folded" now name a ROLLED
  // napkin. The promptFragment is not an identifier and does track the item.
  //
  // SIZE (round-3 correction §13). This entry used to state the GLB's own bounds,
  // 12.2 × 30.78 × 10, and a 30.8 cm napkin cannot be laid on a ⌀23 cm plate: it
  // overhung the cover by 8-11 cm, which IS the "the napkins are not laid on the
  // plate" report. `defaultSize` is now a UNIFORM 0.62 of the file, and
  // `modelSize` states the file's own bbox — both halves in one edit, because
  // shrinking `defaultSize` alone leaves the loader's fit ratio at 1 and 3D goes
  // on drawing the old napkin while 2D draws the new one, silently
  // (handoff/02-migration.md §6; catalog/types.ts:152-168).
  //
  // WHY 0.62, and against which circle. The napkin is laid ON the plate and keeps
  // a rotation of its own once laid (state/actions.ts, `stackedPosition`), so the
  // circle it must fit is its own CIRCUMcircle — its footprint diagonal — not its
  // length. Measured on public/props/decor-place-setting.glb, 2026-07-29: the
  // plate's flat rim is an annulus at r = 12.97…14.39 file cm, i.e. ⌀20.75 inside
  // and ⌀23.03 outside once the cover's uniform 0.8 fit is applied. 0.62 puts the
  // diagonal at hypot(7.56, 19.08) = 20.52, inside the INNER circle: the napkin
  // spans the plate's well and its corners come down on the rim band at every
  // rotation, never on the outer lip. Fitting the OUTER circle instead would
  // allow 0.69, at which a corner reaches the very edge of the plate.
  //
  // The other two napkins need nothing, measured rather than assumed: their GLBs
  // are 5.95 × 10.85 × 12 and 8.64 × 5.45 × 8, so their entries already state the
  // file's own bounds, and their diagonals (12.35 and 10.15) are well inside
  // ⌀20.75. Only this one was longer than the plate.
  {
    ...napkin(surfaceProp('decor.napkin-folded', 'decorNapkinFolded', 'a rolled napkin laid on the place setting', P('decor-napkin-folded.glb'), { width: 7.56, depth: 19.08, height: 6.2 }, '#f0ece4', 'rect')),
    // measured on the shipped GLB, 2026-07-29 (min [-6.1, 0, -15.39], max [6.1, 10, 15.39])
    modelSize: { width: 12.2, depth: 30.78, height: 10 },
  },
  surfaceProp('decor.candleholders-glass', 'decorCandleholdersGlass', 'a row of small glass tealight holders', P('decor-candleholders-glass.glb'), { width: 5.4, depth: 29.4, height: 20 }, '#ccd6da', 'rect'),
  surfaceProp('decor.candelabrum-gold', 'decorCandelabrumGold', 'a gold candelabrum', P('decor-candelabrum-gold.glb'), { width: 30.3, depth: 36.8, height: 55 }, '#c9a86a'),
  surfaceProp('decor.candlestick-gold', 'decorCandlestickGold', 'a slim gold candlestick', P('decor-candlestick-gold.glb'), { width: 6.1, depth: 12.5, height: 40 }, '#c9a86a'),
  surfaceProp('decor.vases-gold-striped', 'decorVasesGoldStriped', 'a pair of gold-striped vases', P('decor-vases-gold-striped.glb'), { width: 10.3, depth: 22.4, height: 38 }, '#c2a25e', 'rect'),
  surfaceProp('decor.candelabrum-golden', 'decorCandelabrumGolden', 'a golden branched candelabrum', P('decor-candelabrum-golden.glb'), { width: 22.6, depth: 23.9, height: 55 }, '#c9a86a'),
  surfaceProp('decor.topiary-green', 'decorTopiaryGreen', 'a clipped green topiary ball in a pot', P('decor-topiary-green.glb'), { width: 32.7, depth: 30.9, height: 45 }, '#5f7f4f'),
  surfaceProp('decor.vase-pampas', 'decorVasePampas', 'a tall vase of dried pampas grass', P('decor-vase-pampas.glb'), { width: 52.7, depth: 61.4, height: 70 }, '#cbb694'),
  surfaceProp('decor.tulips-pink', 'decorTulipsPink', 'an arrangement of pink tulips', P('decor-tulips-pink.glb'), { width: 38.7, depth: 39.1, height: 40 }, '#d78ba3'),
  surfaceProp('decor.bouquet-roses', 'decorBouquetRoses', 'a bouquet of deep red roses', P('decor-bouquet-roses.glb'), { width: 33.2, depth: 34.8, height: 40 }, '#c46a79'),
  surfaceProp('decor.vases-rose-gold', 'decorVasesRoseGold', 'a group of rose-gold vases', P('decor-vases-rose-gold.glb'), { width: 51.9, depth: 71.7, height: 38 }, '#d2a08a', 'rect'),
  surfaceProp('decor.vase-striped', 'decorVaseStriped', 'a striped stoneware vase', P('decor-vase-striped.glb'), { width: 17.9, depth: 18.9, height: 35 }, '#8f8a80'),
  surfaceProp('decor.vases-white-ceramic', 'decorVasesWhiteCeramic', 'a group of white ceramic vases', P('decor-vases-white-ceramic.glb'), { width: 28.4, depth: 33.6, height: 35 }, '#e9e5dd'),
  napkin(surfaceProp('decor.napkin-white', 'decorNapkinWhite', 'a small folded napkin', P('decor-napkin-white.glb'), { width: 8.6, depth: 5.4, height: 8 }, '#f3f0ea', 'rect')),
  surfaceProp('decor.candleholders-wood', 'decorCandleholdersWood', 'a row of turned wooden candle holders', P('decor-candleholders-wood.glb'), { width: 5.3, depth: 21.1, height: 25 }, '#8a6b4f', 'rect'),
  surfaceProp('decor.candlestick-wood', 'decorCandlestickWood', 'a turned wooden candlestick', P('decor-candlestick-wood.glb'), { width: 6.3, depth: 25.1, height: 30 }, '#8a6b4f', 'rect'),
  // The only 'seat'-placement entry: dropping it on a table lays one out in front
  // of EVERY chair (see core/layout/seatItemLayout.ts) instead of one at the pointer.
  //
  // SIZE (source doc §2a and §42). The cover was catalogued at 45 × 33 × 15.9 and
  // BOTH of those last two numbers were wrong: decor-place-setting.glb measures
  // 45.00 × 39.14 × 18.73 (w × d × h), so the file's depth is 6.1cm more and its
  // height 2.8cm more than the entry claimed. With no `modelSize` the loader's fit
  // ratio was 1 (propModel.ts:58-66), so 3D quietly rendered the file's real size
  // while 2D drew the declared one. `modelSize` below states the file's own bbox,
  // which is what makes the fit real; `defaultSize` is a UNIFORM 0.8 of it, so the
  // charger stays a circle instead of being squashed into an ellipse by a
  // non-uniform fit onto the old 45 × 33 aspect.
  //
  // Why 0.8, measured against every table rather than the round one (cover width
  // vs the pitch between neighbouring covers on the line seatItemLayout puts them
  // on — NOT the table rim, which is 22cm further out and flatters the numbers):
  //
  //   table              covers  pitch   overlap @1.0   overlap @0.8
  //   round ⌀180           12    36.9     18.0            5.7
  //   round-large ⌀380     22    48.8      2.4           −8.6   clear
  //   square 160           10    53.3     −8.3          −17.3   clear
  //   banquet 240×120      12    60.0    −15.0          −24.0   clear
  //   knights 480×120      22    53.3     −8.3          −17.3   clear
  //   serpentine           22    44.9      5.9           −5.0   clear
  //
  // 0.8 clears five of the six. The ⌀180 with 12 covers cannot be cleared by any
  // credible size — 12 covers on that circle leaves 36.9cm each, and they splay
  // 30° apart so their far corners meet before their edges do; clearing it needs
  // scale 0.7, at which the charger is 21cm and no longer a dinner plate. That
  // table is genuinely over-set, which seatItemLayout.test.ts records rather than
  // hides. The corners of the three rectangular tables overlap too, and that one
  // is not a size problem at all — see handoff/FOUND-03.md.
  //
  // Height 18.73 → 15.0 is the wine glass, the tallest of the model's 9 meshes.
  //
  // ⚠ THE SEGMENTED FILE, and that is the whole point of source doc §28: glass on
  // the two drinking vessels needs parts that can be addressed separately, and the
  // merged file this replaced was one mesh with one material.
  //
  // Nothing in a Tripo export says which parts are the glasses — all 81 are named
  // `Material_tripo_part_<n>` and declare the same opaque metal. They are found by
  // geometry and renamed by `tools/glb-prep/mark-glass.mjs` (38 fragments of a
  // wine glass, 32 of a water glass), and propModel merges parts that share a
  // name, so the cost is 13 draw calls per cover and not 81 — 286 on a 22-seat
  // table rather than 1,782. It was 1 before, which is the price of the feature.
  //
  // ⚠ RE-PREP WITH `--yaw 180`. The re-import comes out of Tripo turned half a
  // circle from the file it replaces — measured on the same feature, the glass rim,
  // at (−7.898, +14.211) against (+7.899, −14.211). Without the yaw every saved
  // place setting spins 180° and STACK_OFFSETS flips sign:
  //   node glb-prep.mjs "…/ערכת סכום-ריזורט.glb" ../../public/props/decor-place-setting-segmented.glb --mode prop --diameter 45 --yaw 180
  //   node mark-glass.mjs ../../public/props/decor-place-setting-segmented.glb
  // Same 94,352 triangles and the same 45.00 × 39.14 × 18.73 bounds as the merged
  // file, so `modelSize` below is unchanged and no migration is owed.
  {
    ...surfaceProp('decor.place-setting', 'decorPlaceSetting', 'a full place setting: charger, plate, cutlery and a wine glass', P('decor-place-setting-segmented.glb'), { width: 36, depth: 31.3, height: 15 }, '#d9d4cb', 'rect'),
    category: 'tableware',
    placement: 'seat',
    surfaceAnchor: 'free', // one per cover — never the centre
    // measured on the prepped GLB, 2026-07-28 (min [-22.5, 0, -19.57], max [22.5, 18.73, 19.57])
    modelSize: { width: 45, depth: 39.14, height: 18.73 },
  },
]
