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

