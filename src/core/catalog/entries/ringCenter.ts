/**
 * "עיצובי שולחן עיגול גדול" — the pair that fills the open centre of the ⌀380
 * round table. New in schema v9.
 *
 * `table.round-large` (the ⌀380 banquet table, table-round-380.glb) has a real
 * ⌀156 hole through its top — measured, not guessed: radial coverage is 0% inside
 * r=76 and 100% from r=80, so the edge is r≈78 (entries/tables.ts:44-57). These
 * two are what the venue puts in it:
 *
 *   ring.table   the low round table that drops INTO the hole and stands on the
 *                floor through it (source doc §46a)
 *   ring.floral  the arrangement that stands ON that table — `requiresHost:
 *                'ring.table'`, exactly the way the napkins require the place
 *                setting (tableDecor.ts:93). Without the host tag it would be
 *                droppable onto the bare cloth and read as floating (source doc §46)
 *
 * ⚠ THE ENTITIES ARE DECLARED HERE; THE PLACEMENT BEHAVIOUR IS PLAN-07's.
 * Nothing in this file marks `ring.table` as `inHole` — that is a property of the
 * ATTACHMENT written at drop time (`Attachment.surface.inHole`,
 * model/types.ts:40-56), not of the catalog entry, and `clampToSurface`
 * (state/actions.ts:448-458) already drops a centred in-hole item to
 * `elevation: 0`. The mechanism exists; wiring the drop to set the flag is
 * PLAN-07's job and touches state/actions.ts, which this plan may not.
 *
 * Both are `placement: 'surface'` with `surfaceAnchor: 'center'`: the hole is in
 * the middle of the table, so there is nowhere else either of them can go.
 *
 * Built by `surfaceProp` imported from entries/tableDecor.ts, spread with a
 * different `category` — see that file's header for why the recipe is shared
 * rather than copied.
 *
 * `ring.floral`'s size is its measured prepped bounds
 * (handoff/02-a1-measurements.md). `ring.table`'s is NOT: it is the hole, and its
 * file's own bounds are stated separately as `modelSize` so the loader stretches
 * the model onto it. That one entry is sized to a hard constraint rather than to
 * its file — see its comment.
 */
import { surfaceProp } from './tableDecor'
import type { CatalogEntry } from '../types'

const P = (file: string) => `/props/${file}`

/**
 * The same recipe as table decor, filed under 'tables'.
 *
 * ⚠ THE NAME `ringCenter` AND THIS FILE'S NAME MEAN THE ⌀380 RING, NOT A LIBRARY
 * CATEGORY. There WAS a `ringCenter` category — added in v9, one heading for these
 * two items — and v13 removed it: the pair now files under 'tables', beside the
 * table whose hole they fill. The helper keeps its name because the ring it names
 * is still there in the geometry; renaming it to `roundLargeCentre` would say
 * less, not more.
 *
 * Both members stay `placement: 'surface'`, which is what keeps them out of
 * `isFloorTable` (catalog/types.ts) and therefore out of every rule that means
 * "a guest table" by "category is tables".
 */
function ringCenter(...args: Parameters<typeof surfaceProp>): CatalogEntry {
  return { ...surfaceProp(...args), category: 'tables' }
}

export const ringCenterEntries: CatalogEntry[] = [
  // ⌀156 — the hole's own diameter, EXACTLY, and that is the point of the number
  // (source doc §26: "the circle that sits inside must cover the whole hole, there
  // must be no GAP").
  //
  // It used to be ⌀149.7, the GLB's raw bbox, on the reasoning that the model's
  // height is half its diameter so ⌀150 lands its top at 75.05 and 3 cm of
  // clearance is tidy. Both halves of that were wrong in practice: the hole is a
  // REAL hole — 2D draws a `Ring` with the floor showing through it
  // (viewer2d/footprintShapes.tsx) — so "clearance" is 3 cm of visible floor all
  // the way round, and 0.05 cm of extra height is below the model's own Draco
  // noise. Sized to the hole, the gap closes with no inner disc and no special
  // case; `rInner` is 78 (entries/tables.ts:70, measured — see below), so 78×2.
  //
  // ⚠ `modelSize` IS LOAD-BEARING AND MUST STAY. The 3D loader fits by
  // `size / (modelSize ?? defaultSize)` (viewer3d/propModel.ts). With no
  // `modelSize` that ratio is 1 whatever `defaultSize` says, so growing
  // `defaultSize` alone would have left 3D rendering the old ⌀149.7 model inside a
  // ⌀156 2D footprint — the gap still there in the viewport, gone from the plan,
  // and nothing failing anywhere. The numbers below are the file's own measured
  // bbox (`measure-top.mjs ring-center-table.glb`, 2026-07-29:
  // 149.73 × 75.05 × 150), so the loader grows it 1.0419 on x, 1.04 on z and
  // shrinks it 0.9993 on y. ringHole.test.ts asserts the field exists.
  //
  // Height 75, not 75.1: `table.round-large` declares 75, so this makes the two
  // tops exactly flush rather than 1 mm proud. `ring.floral` rides it through
  // `stackHeight`, so the urn follows the millimetre down on its own.
  {
    ...ringCenter('ring.table', 'ringTable',
      'a small round table under a floor-length pleated white cloth',
      P('ring-center-table.glb'), { width: 156, depth: 156, height: 75 }, '#e9e9e9'),
    modelSize: { width: 149.73, depth: 150, height: 75.05 },
  },
  // The arrangement that stands on that table. `requiresHost` is what keeps it
  // there rather than floating on the ⌀380's cloth (source doc §46).
  //
  // The slot reads GREEN, not stone: the foliage covers most of the model's
  // surface, and this colour only fills the 2D footprint — where an arrangement
  // should read as its planting, the way `decor.topiary-green` does, not as its
  // vessel. The urn body alone measures #e1ded9 if that is ever wanted instead.
  //
  // ⚠ Its source GLB contained the table AS WELL AS the urn — the plan (G5) says
  // it is "the design that sits on it", which was wrong about the file. A1 cut the
  // urn free before prepping (handoff/02-a1-measurements.md §6.1), so this entry
  // is the urn alone and `requiresHost` is correct. Shipping the source untouched
  // would have stacked a second table on top of `ring.table`.
  {
    ...ringCenter('ring.floral', 'ringFloral',
      'a fluted urn filled with white rose buds and dense green foliage',
      P('ring-center-floral.glb'), { width: 72, depth: 63.5, height: 86 }, '#697151'),
    requiresHost: 'ring.table',
  },
]
