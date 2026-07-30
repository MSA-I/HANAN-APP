/**
 * What the 3D placement ray is allowed to ask, and at what heights.
 *
 * A plain `.ts` module beside `Placement3D.tsx` on purpose: vitest runs
 * `environment: 'node'` and collects `.test.ts` only, never `.test.tsx`
 * (vite.config.ts), so nothing inside a component can be covered by a test at all.
 * The rules here decide where a click lands — the fault they fix was silent in
 * both directions — so they live where a test can reach them. `Placement3D` and
 * `ObjectGroup` both read them from here.
 */
import type { CatalogEntry } from '../core/catalog/types'
import type { RestrictedZone } from '../core/venuePacks'

/**
 * Does the armed entry go ON a table? Only these two are placed by asking a table
 * where the pointer is; everything else is measured against a pick surface.
 *
 * `ObjectGroup` gates its six preview/commit handlers on this. They used to fire
 * for ANY armed entry and overwrite the ghost with the point where the ray hit the
 * object's own skin — so a chandelier aimed at the ceiling plane 8.95 m up was
 * re-previewed at whatever tabletop the same ray crossed 0.75 m up, metres away in
 * plan, and the ghost stopped following the pointer. R3F walks every intersection
 * along the ray, so the last writer won. The quieter half of the same fault: a
 * FLOOR item hovered over a table previewed 75 cm up instead of on the floor under
 * the cursor.
 */
export function attachesToTable(entry: Pick<CatalogEntry, 'placement'>): boolean {
  return entry.placement === 'surface' || entry.placement === 'seat'
}

/** One horizontal surface the placement ray may land on, in plan cm. */
export interface PickLevel {
  x: number
  y: number
  width: number
  depth: number
  /** cm above the hall floor */
  elevationCm: number
}

/**
 * Every declared level a floor-standing piece could be dropped onto: the hall
 * itself, then one rectangle per raised zone.
 *
 * This is `groundHeightAt`'s "the highest declared level wins" rule
 * (core/layout/groundHeight.ts) restated as GEOMETRY. The picking layer used to
 * build a single plane at 0.005 m, so a click aimed at the +4.70 m reception deck
 * was measured on the hall floor and landed metres past x = 6051 — out of bounds,
 * `commitPlacement3D` returned false, and the click did nothing at all with no
 * indication why. Everything else about deck placement was already right
 * (`allowedOnDeck`, the `check()` branch, `clampToVenue`, `ghostElevation`), which
 * is the tell that the fault was in the ray and not in the rules.
 *
 * The rectangles NEST rather than tile — the deck's canopy pad lies wholly inside
 * the deck — and that is what makes one mesh per level correct without any
 * arbitration: R3F reports intersections near to far, so from any camera above
 * them the highest surface over a point is hit first. Sorting descending here is
 * belt and braces for a camera looking up from underneath.
 *
 * ⚠ Deliberately NOT filtered by which zone is legal for the armed entry. Deciding
 * legality in the picking layer would re-derive `checkPlacement` in a second place
 * and let the two drift; the ray answers "where is the pointer", the rules answer
 * "may it go there", and a refusal is then a red ghost with a violation pill
 * instead of a dead click.
 *
 * ⚠ `activeZone` is not consulted either. `state/store.ts:17-25` declares it a view
 * preference outside the undoable region and AGENT-BRIEF §8.3 states it is never
 * read for placement legality. Reading it here would make the same click legal or
 * illegal depending on where a toolbar toggle happens to be pointing.
 */
export function pickLevelsCm(
  pack: { restricted?: RestrictedZone[] } | undefined,
  venue: { width: number; depth: number },
): PickLevel[] {
  const hall = { x: 0, y: 0, width: venue.width, depth: venue.depth, elevationCm: 0 }
  const raised = (pack?.restricted ?? [])
    .filter((zone) => (zone.elevation ?? 0) > 0)
    .map((zone) => ({
      x: zone.x,
      y: zone.y,
      width: zone.width,
      depth: zone.depth,
      elevationCm: zone.elevation as number,
    }))
  return [...raised, hall].sort((a, b) => b.elevationCm - a.elevationCm)
}

