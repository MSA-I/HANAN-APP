/**
 * The two questions the 3D placement ray asks before it answers anything.
 *
 * Neither can be tested where it is used — vitest collects `.test.ts` only, so a
 * rule that lives inside a component is uncoverable (AGENT-BRIEF §1.7). Both are
 * read off the LIVE catalogue and the LIVE pack, never written down here.
 */
import { describe, expect, it } from 'vitest'
import { listCatalog } from '../core/catalog/registry'
import { getVenuePack } from '../core/venuePacks'
import { attachesToTable, pickLevelsCm } from './placementTargets'

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

/**
 * The component that consumes this cannot be tested (no DOM, no R3F in `node`), so
 * what is pinned is its INPUT: the exact set of planes it will build, and the order.
 */
describe('pickLevelsCm', () => {
  const pack = getVenuePack('resort')!
  const levels = pickLevelsCm(pack, pack.size)

  it('gives the resort the hall plus every raised zone, highest first', () => {
    const raised = pack.restricted!.filter((z) => (z.elevation ?? 0) > 0)
    // the deck, the deck's canopy pad and the hall's ceremony pad — plus the hall
    expect(levels).toHaveLength(raised.length + 1)
    expect(levels.map((l) => l.elevationCm)).toEqual(
      [...raised.map((z) => z.elevation!), 0].sort((a, b) => b - a),
    )
    // descending, which is what makes the deepest-nested rectangle answer first
    // even from a camera looking up from underneath
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i - 1].elevationCm).toBeGreaterThanOrEqual(levels[i].elevationCm)
    }
  })

  it('gives the hall itself the venue rectangle at ground level', () => {
    const hall = levels[levels.length - 1]
    expect(hall).toEqual({ x: 0, y: 0, width: pack.size.width, depth: pack.size.depth, elevationCm: 0 })
  })

  it('sizes each raised plane to its own zone rectangle', () => {
    for (const zone of pack.restricted!.filter((z) => (z.elevation ?? 0) > 0)) {
      expect(levels).toContainEqual({
        x: zone.x,
        y: zone.y,
        width: zone.width,
        depth: zone.depth,
        elevationCm: zone.elevation,
      })
    }
  })

  /**
   * A zone with no `elevation` states no level (groundHeight.ts), and a plane at
   * 0.005 over the pool would shadow nothing but would have to be kept in step with
   * a rule it does not implement. Silence is not a declaration of zero.
   */
  it('ignores a zone that declares no level, and a pack with none at all', () => {
    expect(pack.restricted!.some((z) => z.elevation === undefined)).toBe(true)
    expect(pickLevelsCm(undefined, { width: 1000, depth: 600 })).toEqual([
      { x: 0, y: 0, width: 1000, depth: 600, elevationCm: 0 },
    ])
    expect(
      pickLevelsCm({ restricted: [{ x: 0, y: 0, width: 10, depth: 10 }] }, { width: 100, depth: 100 }),
    ).toHaveLength(1)
  })
})
