/**
 * Suspension cords: where they stand and how thick they are.
 *
 * Both are read through pure functions rather than off the entry directly, which
 * is what lets them be covered at all — `HangingCord` is a component and vitest
 * runs in `node` with no DOM (AGENT-BRIEF §1.7).
 *
 * Every number here comes from the live catalogue. The one exception is the
 * `cordRadiusCm` contract, which is the function's OWN rule and not a fact about
 * any fixture, so those cases use plain literals.
 */
import { describe, expect, it } from 'vitest'
import { cordAnchorPoints, cordRadiusCm } from './beams'
import { getCatalogEntry, listCatalog } from '../catalog/registry'

const CLUSTER = 'lamp.pendant-cluster'

describe('cordAnchorPoints', () => {
  it('gives one cord on the axis when nothing is declared', () => {
    // `from` is the model's own top: an undeclared rod is assumed to reach the
    // bounding box, so the procedural cord starts exactly where the file stops
    const size = { width: 100, depth: 200, height: 60 }
    expect(cordAnchorPoints({}, size)).toEqual([{ x: 0, y: 0, from: 60 }])
    expect(cordAnchorPoints({ cordAnchors: [] }, size)).toEqual([{ x: 0, y: 0, from: 60 }])
    // the single-drum pendant is that case, and MEASURED to be: its own cord sits
    // 0.2 mm off the axis in the file and reaches its very top (see the comment)
    const pendant = getCatalogEntry('lamp.pendant')
    expect(cordAnchorPoints(pendant, pendant.defaultSize)).toEqual([
      { x: 0, y: 0, from: pendant.defaultSize.height },
    ])
  })

  it('gives the cluster one point per drum', () => {
    const entry = getCatalogEntry(CLUSTER)
    expect(entry.cordAnchors).toHaveLength(4)
    expect(cordAnchorPoints(entry, entry.defaultSize)).toHaveLength(4)
  })

  it('keeps every anchor inside the footprint, at the default size and at half of it', () => {
    const entry = getCatalogEntry(CLUSTER)
    for (const scale of [1, 0.5]) {
      const size = {
        width: entry.defaultSize.width * scale,
        depth: entry.defaultSize.depth * scale,
        height: entry.defaultSize.height * scale,
      }
      for (const p of cordAnchorPoints(entry, size)) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(size.width / 2)
        expect(Math.abs(p.y)).toBeLessThanOrEqual(size.depth / 2)
      }
    }
  })

  /**
   * The reason the field holds fractions and not centimetres: the catalogued size
   * is the file's bounds times a scale that has moved twice (×2.5 in round 2,
   * ×6.25 for the pendants in round 4), and this is the property that survived it.
   */
  it('scales linearly with the size, which is why the field is fractions', () => {
    const entry = getCatalogEntry(CLUSTER)
    const base = { width: 100, depth: 100, height: 100 }
    const once = cordAnchorPoints(entry, base)
    const twice = cordAnchorPoints(entry, { width: 200, depth: 200, height: 200 })
    expect(twice).toEqual(once.map((p) => ({ x: p.x * 2, y: p.y * 2, from: p.from * 2 })))
    // and independently per axis, since width and depth scale separately.
    // `toBeCloseTo` on x only: ×3 is not a power of two, so 14.48 × 3 lands one ulp
    // off 3 × 14.48 — the same rounding that made 18.1 × 6.25 = 113.12500000000001
    // in entries/hanging.ts, and just as harmless.
    const wide = cordAnchorPoints(entry, { width: 300, depth: 100, height: 100 })
    expect(wide.map((p) => p.y)).toEqual(once.map((p) => p.y))
    wide.forEach((p, i) => expect(p.x).toBeCloseTo(once[i].x * 3, 9))
  })
})

describe('cordRadiusCm', () => {
  it('is 2% of the width between its two stops', () => {
    expect(cordRadiusCm({ width: 100 })).toBe(2)
    expect(cordRadiusCm({ width: 150 })).toBe(3)
  })

  it('clamps at both ends', () => {
    // a 3 cm wire on a 31 cm pendant was the old fixed radius; below the floor the
    // cord would stop reading as a cord at all
    expect(cordRadiusCm({ width: 10 })).toBe(1.5)
    expect(cordRadiusCm({ width: 0 })).toBe(1.5)
    // and 2% of the 229 cm candelabra would be a 4.6 cm hawser
    expect(cordRadiusCm({ width: 10000 })).toBe(4)
  })

  it('is monotone across the range', () => {
    let previous = -Infinity
    for (let w = 0; w <= 400; w += 5) {
      const r = cordRadiusCm({ width: w })
      expect(r).toBeGreaterThanOrEqual(previous)
      previous = r
    }
  })

  it('gives every ceiling fixture a radius inside its own stops', () => {
    for (const entry of listCatalog().filter((e) => e.placement === 'ceiling')) {
      const r = cordRadiusCm(entry.defaultSize)
      expect(r, entry.id).toBeGreaterThanOrEqual(1.5)
      expect(r, entry.id).toBeLessThanOrEqual(4)
    }
  })
})

/**
 * The catalogue-wide invariants. `cordAnchors` is only meaningful above the truss,
 * and a component outside [−0.5, 0.5] would put a cord outside the fixture it is
 * supposed to hold up — neither is checked anywhere else, and both are the kind of
 * thing a future entry gets wrong by copying a neighbour.
 */
describe('cordAnchors across the catalogue', () => {
  const withAnchors = listCatalog().filter((e) => e.cordAnchors?.length)

  it('is declared only by the cluster, and only by a ceiling fixture', () => {
    expect(withAnchors.map((e) => e.id)).toEqual([CLUSTER])
    for (const entry of withAnchors) expect(entry.placement).toBe('ceiling')
  })

  it('holds every component inside the footprint half-extents', () => {
    for (const entry of withAnchors) {
      for (const a of entry.cordAnchors!) {
        expect(Math.abs(a.x), entry.id).toBeLessThanOrEqual(0.5)
        expect(Math.abs(a.y), entry.id).toBeLessThanOrEqual(0.5)
      }
    }
  })

  /**
   * Two cords in the same place would be one cord drawn twice — and `HangingCord`
   * keys its meshes on the point, so React would drop the duplicate silently.
   */
  it('has no two cords at the same point', () => {
    for (const entry of withAnchors) {
      const keys = entry.cordAnchors!.map((a) => `${a.x},${a.y}`)
      expect(new Set(keys).size, entry.id).toBe(keys.length)
    }
  })

  /**
   * A rod cannot end below the fixture or above it. Absent means 1 — the rod
   * reaches the top of the bbox — so only a DECLARED value is checked here.
   */
  it('keeps every declared rod top inside the model', () => {
    for (const entry of withAnchors) {
      for (const a of entry.cordAnchors!) {
        if (a.top === undefined) continue
        expect(a.top, entry.id).toBeGreaterThan(0)
        expect(a.top, entry.id).toBeLessThanOrEqual(1)
      }
    }
  })

  /**
   * THE DEFECT THIS FIELD EXISTS FOR, stated as an assertion rather than a
   * comment: the cluster's rods are staggered, exactly one reaches the top, and
   * the other three leave a gap the procedural cord has to fill. If a re-prep
   * ever makes them equal, this fails and the `top` values want re-measuring
   * (tools/glb-prep/measure-cord-anchors.mjs, "CORD TOPS").
   */
  it('records the cluster as genuinely staggered — one rod at the top, three short', () => {
    const tops = getCatalogEntry(CLUSTER).cordAnchors!.map((a) => a.top ?? 1)
    expect(tops.filter((t) => t === 1)).toHaveLength(1)
    expect(tops.filter((t) => t < 1)).toHaveLength(3)
    // and short by enough to see: a third of a 375 cm fixture is over a metre
    for (const t of tops.filter((t) => t < 1)) expect(t).toBeLessThan(0.7)
  })
})

/**
 * The arithmetic `HangingCord` does per cord, pinned here because the component
 * itself cannot be tested (vitest runs `environment: 'node'`).
 *
 * Each cord is the SHARED DROP plus its own shortfall: `drop + (height − from)`.
 * The drop is measured from the top of the bounding box, and a rod that stops
 * below that has to make up the difference as well.
 */
describe('per-cord length', () => {
  const entry = getCatalogEntry(CLUSTER)
  const size = entry.defaultSize
  const lengths = (drop: number) =>
    cordAnchorPoints(entry, size).map((c) => drop + (size.height - c.from))

  it('draws nothing for a full-height rod at the seeded elevation, and the gap for the others', () => {
    const at0 = lengths(0)
    // the one rod that reaches the top has nothing to bridge and nothing to drop
    expect(at0.filter((l) => l === 0)).toHaveLength(1)
    // the other three bridge their own shortfall — over a metre on a 375 cm fixture
    const bridged = at0.filter((l) => l > 0)
    expect(bridged).toHaveLength(3)
    for (const l of bridged) expect(l).toBeGreaterThan(100)
  })

  it('gives every cord the same extra when the fixture is pulled down', () => {
    const at0 = lengths(0)
    const at200 = lengths(200)
    expect(at200).toEqual(at0.map((l) => l + 200))
    // and then EVERY cord is drawn, including the one that drew nothing before
    for (const l of at200) expect(l).toBeGreaterThan(0)
  })

  it('reaches the truss from every cord — the point of the exercise', () => {
    // a cord spans [from, from + length]; with the drop measured to the truss,
    // every top lands on the same plane
    const drop = 200
    const tops = cordAnchorPoints(entry, size).map((c) => c.from + (drop + (size.height - c.from)))
    for (const t of tops) expect(t).toBeCloseTo(size.height + drop, 9)
  })
})
