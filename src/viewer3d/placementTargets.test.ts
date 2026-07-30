/**
 * The two questions the 3D placement ray asks before it answers anything.
 *
 * Neither can be tested where it is used — vitest collects `.test.ts` only, so a
 * rule that lives inside a component is uncoverable (AGENT-BRIEF §1.7). Both are
 * read off the LIVE catalogue and the LIVE pack, never written down here.
 */
import { describe, expect, it } from 'vitest'
import { listCatalog } from '../core/catalog/registry'
import { attachesToTable } from './placementTargets'

describe('attachesToTable', () => {
  const catalogue = listCatalog()

  it('is true for exactly the surface and seat entries in the catalogue', () => {
    const wants = catalogue.filter(attachesToTable).map((e) => e.id).sort()
    const onATable = catalogue
      .filter((e) => e.placement === 'surface' || e.placement === 'seat')
      .map((e) => e.id)
      .sort()
    expect(wants).toEqual(onATable)
    // not vacuous: the catalogue really does hold some of each
    expect(catalogue.some((e) => e.placement === 'surface')).toBe(true)
    expect(catalogue.some((e) => e.placement === 'seat')).toBe(true)
  })

  /**
   * The two families the fix is about. A ceiling fixture is measured against a
   * pick plane 8.95 m up and a floor piece against the floor under the cursor;
   * an object that answered for either handed back the point where the ray hit
   * its own skin instead, which is what made the ghost stop following the mouse.
   */
  it('is false for every ceiling fixture and every floor-standing piece', () => {
    const off = catalogue.filter((e) => e.placement === 'ceiling' || e.placement === undefined)
    expect(off.length).toBeGreaterThan(0)
    for (const entry of off) expect(attachesToTable(entry)).toBe(false)
    expect(catalogue.filter((e) => e.placement === 'ceiling').length).toBeGreaterThan(0)
  })
})
