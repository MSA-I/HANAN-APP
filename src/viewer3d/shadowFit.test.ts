import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LIGHTING } from '../core/model/types'
import { cmToM } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { addObject, newProject } from '../state/actions'
import { useEditorStore } from '../state/store'
import { clampBounds, contentBounds, fitShadowCamera, toLightSpace, type Bounds3 } from './shadowFit'

const PACK = getVenuePack('resort')!
const W = cmToM(PACK.size.width)
const D = cmToM(PACK.size.depth)
const H = cmToM(PACK.wallHeight)
const VENUE: Bounds3 = { min: [0, 0, 0], max: [W, H, D] }
const OPTS = { margin: 3, minHalfExtent: 12 }

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

  it('gains an order of magnitude when the furniture is clustered', () => {
    const cluster: Bounds3 = { min: [10, 0, 5], max: [25, 1.5, 20] }
    const box = fitShadowCamera(eye, TARGET, cluster, VENUE, OPTS)

    expect(areaOf(box)).toBeLessThan((OLD_SIDE * OLD_SIDE) / 12)
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
