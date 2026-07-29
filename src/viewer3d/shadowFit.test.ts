import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LIGHTING } from '../core/model/types'
import { cmToM } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { addObject, newProject } from '../state/actions'
import { useEditorStore } from '../state/store'
import {
  clampBounds,
  contentBounds,
  fitShadowCamera,
  shadowContent,
  toLightSpace,
  unionBounds,
  type Bounds3,
} from './shadowFit'

const PACK = getVenuePack('resort')!
const W = cmToM(PACK.size.width)
const D = cmToM(PACK.size.depth)
const H = cmToM(PACK.wallHeight)
const VENUE: Bounds3 = { min: [0, 0, 0], max: [W, H, D] }
const OPTS = { margin: 3, minHalfExtent: 12 }
/** LightingRig's `limit`: the venue plus its margin. */
const LIMIT: Bounds3 = {
  min: [-OPTS.margin, -OPTS.margin, -OPTS.margin],
  max: [W + OPTS.margin, H + OPTS.margin, D + OPTS.margin],
}
/** LightingRig's `medium` map, which is also the fixed size every project used before the setting. */
const MAP_SIZE = 4096

/** The rig's sun, decomposed the same way LightingRig does it. */
function sunAt(azimuth: number, elevation: number): [number, number, number] {
  const diag = Math.hypot(W, D)
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  return [
    W / 2 - diag * Math.cos(el) * Math.sin(az),
    diag * Math.sin(el),
    D / 2 - diag * Math.cos(el) * Math.cos(az),
  ]
}

const TARGET: [number, number, number] = [W / 2, 0, D / 2]

beforeEach(() => {
  newProject({ name: 'shadow-fit', venuePackId: 'resort' })
})

describe('contentBounds', () => {
  // A PROCEDURAL room, not the resort. `createDefaultScene` seeds the resort's
  // bar fittings into every project of that pack (core/venueFixtures.ts), so a
  // resort scene is never empty and its content box always reaches the bar. That
  // is correct behaviour and it is asserted on its own below; these two are about
  // what `contentBounds` does with an arbitrary scene, and a room with no pack is
  // the only place that question can still be asked.
  beforeEach(() => {
    newProject({ name: 'shadow-fit-plain', venueWidth: 2400, venueDepth: 1600 })
  })

  it('is null for an empty scene, so the caller keeps the venue box', () => {
    expect(contentBounds(useEditorStore.getState().scene)).toBeNull()
  })

  it('wraps a placed table and its chairs, and reaches down to the floor', () => {
    addObject('table.round', { x: 600, y: 600 })
    const bounds = contentBounds(useEditorStore.getState().scene)!

    expect(bounds).not.toBeNull()
    expect(bounds.min[1]).toBe(0)
    // the table sits at plan (600, 600) cm → three (6, _, 6) m, chairs around it
    expect(bounds.min[0]).toBeLessThan(6)
    expect(bounds.max[0]).toBeGreaterThan(6)
    expect(bounds.min[2]).toBeLessThan(6)
    expect(bounds.max[2]).toBeGreaterThan(6)
    // …and nothing like the whole room
    expect(bounds.max[0] - bounds.min[0]).toBeLessThan(cmToM(2400) / 2)
  })

  it('counts the venue fittings as content — a resort scene is never empty', () => {
    // The interaction that first showed up as a broken test when PLAN-1B's bake
    // met PLAN-05's shadow box: the bar is scene geometry, it casts and receives,
    // so the shadow camera has to frame it even in a project with no furniture.
    // Overrides the procedural room this block otherwise works in.
    newProject({ name: 'shadow-fit-resort', venuePackId: 'resort' })
    const bounds = contentBounds(useEditorStore.getState().scene)!
    expect(bounds).not.toBeNull()
    // the bake put the bar assembly around plan x 1929…2449, y 0…345
    expect(bounds.min[0]).toBeLessThan(cmToM(2000))
    expect(bounds.max[0]).toBeGreaterThan(cmToM(2400))
    expect(bounds.min[2]).toBeLessThan(cmToM(200))
  })
})

describe('fitShadowCamera', () => {
  const eye = sunAt(DEFAULT_LIGHTING.sunAzimuth, DEFAULT_LIGHTING.sunElevation)

  // the old rig: span = max(W, D) * 0.9, box = 2 * span on BOTH axes
  const OLD_SIDE = 2 * Math.max(W, D) * 0.9
  const areaOf = (box: { left: number; right: number; top: number; bottom: number }) =>
    (box.right - box.left) * (box.top - box.bottom)
  /** The map is square, so the wider axis sets the sampling density for both. */
  const cmPerTexel = (
    box: { left: number; right: number; top: number; bottom: number },
    mapSize: number,
  ) => (Math.max(box.right - box.left, box.top - box.bottom) / mapSize) * 100

  it('shrinks even the worst case — a hall furnished wall to wall, floor to roof', () => {
    const box = fitShadowCamera(eye, TARGET, VENUE, VENUE, OPTS)

    expect(box.right - box.left).toBeLessThan(OLD_SIDE)
    expect(box.top - box.bottom).toBeLessThan(OLD_SIDE)
    expect(areaOf(box)).toBeLessThan((OLD_SIDE * OLD_SIDE) / 2)
  })

  it('takes a wall-to-wall furnished hall under one texel per chair leg', () => {
    // what a full hall of tables actually is: the whole footprint, 1.5 m tall.
    // Measured 2.9x the area of the old box — the hall rectangle is 50° off the
    // light's axes, so its axis-aligned footprint in light space is wider than
    // the rectangle. On a 2048 map that is ~3.2 cm/texel against the old 5.3,
    // which is the line a 4 cm chair leg has to be on the right side of.
    const furniture: Bounds3 = { min: [0, 0, 0], max: [W, 1.5, D] }
    const box = fitShadowCamera(eye, TARGET, furniture, VENUE, OPTS)

    expect(areaOf(box)).toBeLessThan((OLD_SIDE * OLD_SIDE) / 2.5)
    expect(Math.max(box.right - box.left, box.top - box.bottom) / 2048).toBeLessThan(0.04)
  })

  it('no longer shrinks onto clustered furniture, and still holds the far corner', () => {
    // R3 reversed this test. It used to be "gains an order of magnitude when the
    // furniture is clustered" and asserted area < OLD_SIDE² / 12 — true, and the
    // reason the far end of the hall received no sun shadow at all. The box now
    // always contains the venue (shadowContent), so clustering buys nothing.
    const cluster: Bounds3 = { min: [10, 0, 5], max: [25, 1.5, 20] }
    const clustered = fitShadowCamera(eye, TARGET, unionBounds(cluster, VENUE), VENUE, OPTS)
    const emptyHall = fitShadowCamera(eye, TARGET, VENUE, VENUE, OPTS)

    // a clustered hall now costs exactly what an empty hall has always cost
    expect(areaOf(clustered)).toBeCloseTo(areaOf(emptyHall), 6)

    for (const [px, pz] of [
      [0, 0],
      [PACK.size.width, 0],
      [0, PACK.size.depth],
      [PACK.size.width, PACK.size.depth],
    ]) {
      const [u, v] = toLightSpace(eye, TARGET, [cmToM(px), 0, cmToM(pz)])
      expect(u).toBeGreaterThanOrEqual(clustered.left)
      expect(u).toBeLessThanOrEqual(clustered.right)
      expect(v).toBeGreaterThanOrEqual(clustered.bottom)
      expect(v).toBeLessThanOrEqual(clustered.top)
    }

    // …and the old box really did drop a corner, so the assertion above is not free
    const old = fitShadowCamera(eye, TARGET, cluster, VENUE, OPTS)
    const [fu, fv] = toLightSpace(eye, TARGET, [W, 0, D])
    expect(fu > old.right || fu < old.left || fv > old.top || fv < old.bottom).toBe(true)
  })

  it('costs cm per texel only where the box used to be too small to be correct', () => {
    // The mandatory measurement for PLAN-03: what including the venue laterally
    // does to sampling density, at the 4096 'medium' map every project renders
    // today. `before` is the old contract (clamped content, venue only as the
    // empty-scene fallback); `after` is shadowContent's union.
    //
    // Measured on the resort, cm/texel at 4096 (the fitted box is 64.07 x 68.08 m
    // in light space, so the v axis sets the density):
    //   clustered in a corner   before 0.662   after 1.662
    //   wall to wall            before 1.564   after 1.662
    //   empty hall              before 1.662   after 1.662
    // For reference the same table at 2048 is 1.324 / 3.128 / 3.324 before and a
    // flat 3.324 after; at 8192 it is 0.331 / 0.782 / 0.831 before and 0.831
    // after. That is the whole shape of the trade: 1.662 cm is now the CEILING
    // on coarseness for every scene at 4096, where before it was the ceiling for
    // an empty hall and a clustered one bought 0.662 by dropping the rest of the
    // hall out of the frustum entirely.
    const clustered: Bounds3 = { min: [2, 0, 2], max: [17, 1.5, 17] }
    const wallToWall: Bounds3 = { min: [0, 0, 0], max: [W, 1.5, D] }
    const before = (found: Bounds3 | null) => (found ? clampBounds(found, LIMIT) : VENUE)
    const after = (found: Bounds3 | null) =>
      found ? unionBounds(clampBounds(found, LIMIT), VENUE) : VENUE
    const measure = (content: Bounds3) =>
      cmPerTexel(fitShadowCamera(eye, TARGET, content, VENUE, OPTS), MAP_SIZE)

    // the empty hall is the ceiling on coarseness, and it did not move
    const ceiling = measure(after(null))
    expect(measure(before(null))).toBeCloseTo(ceiling, 6)
    // nothing is ever coarser than it, before or after
    for (const content of [clustered, wallToWall]) {
      expect(measure(before(content))).toBeLessThanOrEqual(ceiling + 1e-9)
      expect(measure(after(content))).toBeCloseTo(ceiling, 6)
    }
    // wall-to-wall barely moves — it already spanned the venue, and only the
    // venue's HEIGHT (11.6 m of wall against 1.5 m of furniture) widens its
    // light-space footprint at all
    expect(measure(before(wallToWall))).toBeGreaterThan(0.9 * ceiling)
    // the clustered hall is the only one that pays, and it pays 2.5x
    expect(measure(before(clustered))).toBeLessThan(0.5 * ceiling)

    // absolute sanity: a 4 cm chair leg still spans more than one texel at 4096,
    // which is the line the R2 fitted box was introduced to stay on
    expect(ceiling).toBeLessThan(4)
  })

  it('shrinks the depth range too, which is what the bias is scaled against', () => {
    const box = fitShadowCamera(eye, TARGET, VENUE, VENUE, OPTS)
    const diag = Math.hypot(W, D)

    expect(box.near).toBeGreaterThan(0.1)
    expect(box.far).toBeGreaterThan(box.near)
    // the old range was 0.5 … diag * 4 + H * 3
    expect(box.far - box.near).toBeLessThan((diag * 4 + H * 3) / 3)
  })

  it.each([
    ['north-west', 0, 0],
    ['north-east', PACK.size.width, 0],
    ['south-west', 0, PACK.size.depth],
    ['south-east', PACK.size.width, PACK.size.depth],
  ])('keeps a caster in the %s corner inside the box', (_name, planX, planY) => {
    // the documented risk: a tight box that clips the corners of the hall
    const object: Bounds3 = {
      min: [cmToM(planX) - 1, 0, cmToM(planY) - 1],
      max: [cmToM(planX) + 1, 1.5, cmToM(planY) + 1],
    }
    const box = fitShadowCamera(eye, TARGET, clampBounds(object, VENUE), VENUE, OPTS)

    for (const x of [object.min[0], object.max[0]]) {
      for (const y of [object.min[1], object.max[1]]) {
        for (const z of [object.min[2], object.max[2]]) {
          const [u, v, d] = toLightSpace(eye, TARGET, [x, y, z])
          expect(u).toBeGreaterThanOrEqual(box.left)
          expect(u).toBeLessThanOrEqual(box.right)
          expect(v).toBeGreaterThanOrEqual(box.bottom)
          expect(v).toBeLessThanOrEqual(box.top)
          expect(d).toBeGreaterThanOrEqual(box.near)
          expect(d).toBeLessThanOrEqual(box.far)
        }
      }
    }
  })

  it('never collapses below the minimum half-extent', () => {
    const chair: Bounds3 = { min: [10, 0, 10], max: [10.5, 0.9, 10.5] }
    const box = fitShadowCamera(eye, TARGET, chair, VENUE, OPTS)

    expect(box.right - box.left).toBeCloseTo(2 * OPTS.minHalfExtent, 6)
    expect(box.top - box.bottom).toBeCloseTo(2 * OPTS.minHalfExtent, 6)
  })

  it.each([5, 45, 89.9, 90])('stays finite with the sun %s° above the horizon', (elevation) => {
    const box = fitShadowCamera(sunAt(120, elevation), TARGET, VENUE, VENUE, OPTS)
    for (const value of [box.left, box.right, box.top, box.bottom, box.near, box.far]) {
      expect(Number.isFinite(value)).toBe(true)
    }
    expect(box.right).toBeGreaterThan(box.left)
    expect(box.top).toBeGreaterThan(box.bottom)
  })
})

describe('clampBounds', () => {
  it('holds a runaway box inside the venue', () => {
    const wild: Bounds3 = { min: [-500, -20, -500], max: [900, 90, 900] }
    expect(clampBounds(wild, VENUE)).toEqual(VENUE)
  })
})

describe('shadowContent', () => {
  const contains = (outer: Bounds3, inner: Bounds3) =>
    [0, 1, 2].every((i) => outer.min[i] <= inner.min[i] + 1e-9 && outer.max[i] >= inner.max[i] - 1e-9)

  it('keeps the whole venue even when every object sits in one corner', () => {
    // the shape of the reported bug: a hall furnished only near the entrance
    addObject('table.round', { x: 400, y: 400 })
    addObject('table.round', { x: 700, y: 400 })
    const box = shadowContent(useEditorStore.getState().scene, VENUE, LIMIT)

    expect(contains(box, VENUE)).toBe(true)
    // the clamped content alone did NOT — that is what changed
    expect(contains(clampBounds(contentBounds(useEditorStore.getState().scene)!, LIMIT), VENUE)).toBe(
      false,
    )
  })

  it('falls back to the venue for a scene with nothing in it', () => {
    // a resort project is never empty (venueFixtures bakes the bar in), so the
    // only place this branch can be reached is a pack-less procedural room
    newProject({ name: 'shadow-content-plain', venueWidth: 2400, venueDepth: 1600 })
    const room: Bounds3 = { min: [0, 0, 0], max: [cmToM(2400), cmToM(300), cmToM(1600)] }
    expect(shadowContent(useEditorStore.getState().scene, room, room)).toEqual(room)
  })

  it('unions rather than replaces, so content outside the venue box still widens it', () => {
    // the direction that is easy to get backwards. A deliberately undersized
    // venue box stands in for the real cases where content legitimately leaves
    // the walls: zone platforms lift objects above wallHeight, and a footprint
    // is approximated as a disc that pokes past an object placed at the edge.
    const tiny: Bounds3 = { min: [0, 0, 0], max: [1, 1, 1] }
    const found = contentBounds(useEditorStore.getState().scene)!
    const box = shadowContent(useEditorStore.getState().scene, tiny, LIMIT)

    expect(contains(box, tiny)).toBe(true)
    expect(contains(box, clampBounds(found, LIMIT))).toBe(true)
  })
})
