/**
 * The 3D loading card.
 *
 * One claim carries this file: the bar cannot go backwards. drei resets
 * `useProgress().progress` to 0 whenever a new loader registers, so the reset is
 * not a fault to defend against — it is the NORMAL shape of a two-batch venue
 * load, and it happens on the resort pack every time. The `feed` helper below
 * replays a whole session frame by frame the way the component will, because a
 * monotonicity claim is about a sequence and cannot be tested one call at a time.
 */
import { describe, expect, it } from 'vitest'
import { loadPhase, SLOW_AFTER_MS, type LoadPhaseInput, type LoadPhaseResult } from './loadPhase'

type Frame = Omit<LoadPhaseInput, 'prevPercent'>

const frame = (over: Partial<Frame> = {}): Frame => ({
  moduleReady: true,
  active: true,
  progress: 0,
  total: 1,
  elapsedMs: 0,
  ...over,
})

/** Replay frames exactly as the component will: last percent back in as prevPercent. */
function feed(frames: Frame[]): LoadPhaseResult[] {
  const out: LoadPhaseResult[] = []
  let prevPercent = 0
  for (const f of frames) {
    const result = loadPhase({ ...f, prevPercent })
    prevPercent = result.percent
    out.push(result)
  }
  return out
}

describe('which phase the card is in', () => {
  it('waits on the chunk before it waits on anything else', () => {
    const out = loadPhase({ ...frame({ moduleReady: false, active: false, total: 0 }), prevPercent: 0 })
    expect(out.phase).toBe('module')
    expect(out.percent).toBe(0)
  })

  it('counts assets once the chunk is in', () => {
    const out = loadPhase({ ...frame({ progress: 40, total: 12 }), prevPercent: 0 })
    expect(out.phase).toBe('assets')
    expect(out.percent).toBe(40)
  })

  it('is ready when nothing is loading any more, with a full bar', () => {
    const out = loadPhase({ ...frame({ active: false, progress: 0, total: 0 }), prevPercent: 62 })
    expect(out.phase).toBe('ready')
    expect(out.percent).toBe(100)
  })

  /** The chunk cannot have registered a loader, so this pair must not read ready. */
  it('stays in the module phase even when drei reports nothing active', () => {
    const out = loadPhase({
      ...frame({ moduleReady: false, active: false, total: 0 }),
      prevPercent: 0,
    })
    expect(out.phase).toBe('module')
  })
})

describe('the bar never goes backwards', () => {
  /** The resort pack in two batches: props, then the venue's own GLB. */
  it('holds through drei resetting progress to 0 for a second batch', () => {
    const out = feed([
      frame({ progress: 0, total: 6 }),
      frame({ progress: 30, total: 6 }),
      frame({ progress: 60, total: 6 }),
      frame({ progress: 0, total: 9 }), // a new loader registers — drei starts over
      frame({ progress: 20, total: 9 }),
      frame({ progress: 100, total: 9 }),
    ])
    expect(out.map((o) => o.percent)).toEqual([0, 30, 60, 60, 60, 100])
  })

  it('is non-decreasing across any sequence at all', () => {
    const noisy: Frame[] = []
    for (let i = 0; i < 60; i++) {
      noisy.push(frame({ progress: (i * 37) % 101, total: (i % 5) + 1, elapsedMs: i * 100 }))
    }
    const percents = feed(noisy).map((o) => o.percent)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })

  it('a single reset cannot lower the output', () => {
    const held = loadPhase({ ...frame({ progress: 0, total: 9 }), prevPercent: 60 })
    expect(held.percent).toBe(60)
  })

  it('starts over when the CALLER says a new load began', () => {
    // this is the whole reason prevPercent is an input: a second venue switch
    // must reset, and only the caller knows that it is a second one
    expect(loadPhase({ ...frame({ progress: 5, total: 3 }), prevPercent: 0 }).percent).toBe(5)
  })
})

describe('an indeterminate batch', () => {
  it('holds the bar rather than printing a percentage of nothing', () => {
    expect(loadPhase({ ...frame({ progress: 100, total: 0 }), prevPercent: 0 }).percent).toBe(0)
    expect(loadPhase({ ...frame({ progress: 100, total: 0 }), prevPercent: 45 }).percent).toBe(45)
  })

  it('is still the assets phase — something is loading, we just cannot count it', () => {
    expect(loadPhase({ ...frame({ total: 0 }), prevPercent: 0 }).phase).toBe('assets')
  })
})

describe('a slow load', () => {
  it('flips at the mark, not one tick past it', () => {
    expect(loadPhase({ ...frame({ elapsedMs: SLOW_AFTER_MS - 1 }), prevPercent: 0 }).slow).toBe(false)
    expect(loadPhase({ ...frame({ elapsedMs: SLOW_AFTER_MS }), prevPercent: 0 }).slow).toBe(true)
    expect(loadPhase({ ...frame({ elapsedMs: 30000 }), prevPercent: 0 }).slow).toBe(true)
  })

  it('applies to a slow chunk as much as to slow assets', () => {
    const out = loadPhase({
      ...frame({ moduleReady: false, active: false, total: 0, elapsedMs: 9000 }),
      prevPercent: 0,
    })
    expect(out).toEqual({ phase: 'module', percent: 0, slow: true })
  })

  /** Nothing is still loading, so there is nothing left to apologise for. */
  it('is off the moment the load is done, however long it took', () => {
    const out = loadPhase({
      ...frame({ active: false, total: 0, elapsedMs: 60000 }),
      prevPercent: 100,
    })
    expect(out).toEqual({ phase: 'ready', percent: 100, slow: false })
  })
})

describe('values the loader has no business producing', () => {
  it('clamps progress into 0–100', () => {
    expect(loadPhase({ ...frame({ progress: 140, total: 2 }), prevPercent: 0 }).percent).toBe(100)
    expect(loadPhase({ ...frame({ progress: -20, total: 2 }), prevPercent: 0 }).percent).toBe(0)
  })

  it('clamps a nonsense prevPercent instead of pinning the bar past full', () => {
    expect(loadPhase({ ...frame({ progress: 10, total: 2 }), prevPercent: 400 }).percent).toBe(100)
    expect(loadPhase({ ...frame({ progress: 10, total: 2 }), prevPercent: -5 }).percent).toBe(10)
  })

  it('treats NaN as no information rather than drawing a NaN-wide bar', () => {
    expect(loadPhase({ ...frame({ progress: NaN, total: 2 }), prevPercent: 30 }).percent).toBe(30)
    expect(loadPhase({ ...frame({ progress: 50, total: 2 }), prevPercent: NaN }).percent).toBe(50)
    expect(loadPhase({ ...frame({ elapsedMs: NaN }), prevPercent: 0 }).slow).toBe(false)
  })
})
