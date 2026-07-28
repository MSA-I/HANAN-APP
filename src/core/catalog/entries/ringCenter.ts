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
 * Sizes are A1's measured prepped bounds (handoff/02-a1-measurements.md). The one
 * hard constraint: `ring-center-table.glb` must fit the ⌀156 hole. If it measures
 * larger it is reported, not squeezed — see the plan's rule A1/2.
 */
import { surfaceProp } from './tableDecor'
import type { CatalogEntry } from '../types'

const P = (file: string) => `/props/${file}`

/** The same recipe as table decor, filed under the ring-centre category. */
function ringCenter(...args: Parameters<typeof surfaceProp>): CatalogEntry {
  return { ...surfaceProp(...args), category: 'ringCenter' }
}

export const ringCenterEntries: CatalogEntry[] = [
  // ⌀150, and the diameter is derived rather than chosen: the model's height is
  // exactly half its diameter (measured 0.5004), so ⌀150 puts its top at 75.05 cm
  // — level with `table.round-large`'s own 75 cm top, so it sits FLUSH in the well
  // instead of standing proud or sunk. It also clears the ⌀156 hole by 3 cm per
  // side; ⌀156 would have made it 78 cm tall and left no clearance at all.
  ringCenter('ring.table', 'ringTable',
    'a small round table under a floor-length pleated white cloth',
    P('ring-center-table.glb'), { width: 149.7, depth: 150, height: 75.1 }, '#e9e9e9'),
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
