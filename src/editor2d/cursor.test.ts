/**
 * The plan cursor, as a table.
 *
 * All 32 combinations are enumerated rather than sampled. A wrong cursor is
 * invisible in a screenshot, survives every visual check, and gets reported as
 * "the canvas feels off" if it gets reported at all — so the only way it stays
 * right is if every state has an expectation written down next to it.
 */
import { describe, expect, it } from 'vitest'
import { cursorFor, type CursorContext, type CursorStyle } from './cursor'

const OFF: CursorContext = {
  panMode: false,
  panning: false,
  placing: false,
  ghostValid: false,
  hovering: false,
}

const ctx = (over: Partial<CursorContext> = {}): CursorContext => ({ ...OFF, ...over })

/** Every reachable context — 2^5. */
function everyContext(): CursorContext[] {
  const out: CursorContext[] = []
  for (const panMode of [false, true]) {
    for (const panning of [false, true]) {
      for (const placing of [false, true]) {
        for (const ghostValid of [false, true]) {
          for (const hovering of [false, true]) {
            out.push({ panMode, panning, placing, ghostValid, hovering })
          }
        }
      }
    }
  }
  return out
}

describe('the matrix', () => {
  it('reads each state on its own', () => {
    expect(cursorFor(ctx({ panMode: true }))).toBe('grab')
    expect(cursorFor(ctx({ panMode: true, panning: true }))).toBe('grabbing')
    expect(cursorFor(ctx({ placing: true, ghostValid: true }))).toBe('copy')
    expect(cursorFor(ctx({ placing: true, ghostValid: false }))).toBe('not-allowed')
    expect(cursorFor(ctx({ hovering: true }))).toBe('move')
    expect(cursorFor(OFF)).toBe('default')
  })

  it('ignores ghost validity when nothing is armed', () => {
    expect(cursorFor(ctx({ ghostValid: true }))).toBe('default')
    expect(cursorFor(ctx({ ghostValid: true, hovering: true }))).toBe('move')
  })

  it('covers all 32 contexts and answers every one of them', () => {
    const contexts = everyContext()
    expect(contexts).toHaveLength(32)
    const allowed: CursorStyle[] = ['grab', 'grabbing', 'copy', 'not-allowed', 'move', 'default']
    for (const c of contexts) expect(allowed).toContain(cursorFor(c))
  })

  /** `pointer` means "this is a link". A floor plan has none. */
  it('never says pointer, in any state at all', () => {
    for (const c of everyContext()) expect(String(cursorFor(c))).not.toBe('pointer')
  })
})

describe('precedence', () => {
  it('a pan in progress beats everything, however it was armed', () => {
    expect(cursorFor(ctx({ panning: true }))).toBe('grabbing')
    expect(cursorFor(ctx({ panning: true, panMode: true }))).toBe('grabbing')
    expect(
      cursorFor(ctx({ panning: true, placing: true, ghostValid: true, hovering: true })),
    ).toBe('grabbing')
  })

  /** What Stage2D does today: with the hand tool on, an armed item waits. */
  it('the pan tool beats an armed item', () => {
    expect(cursorFor(ctx({ panMode: true, placing: true, ghostValid: true }))).toBe('grab')
    expect(cursorFor(ctx({ panMode: true, placing: true, ghostValid: false }))).toBe('grab')
  })

  it('an armed item beats a hover — the next press drops, it does not grab', () => {
    expect(cursorFor(ctx({ placing: true, ghostValid: true, hovering: true }))).toBe('copy')
    expect(cursorFor(ctx({ placing: true, ghostValid: false, hovering: true }))).toBe('not-allowed')
  })

  it('a hover beats nothing at all', () => {
    expect(cursorFor(ctx({ hovering: true }))).toBe('move')
  })

  /** Stated as a whole so reordering the function fails here, not in one pair. */
  it('resolves every context by the ranked rule', () => {
    for (const c of everyContext()) {
      const expected: CursorStyle = c.panning
        ? 'grabbing'
        : c.panMode
          ? 'grab'
          : c.placing
            ? c.ghostValid
              ? 'copy'
              : 'not-allowed'
            : c.hovering
              ? 'move'
              : 'default'
      expect(cursorFor(c)).toBe(expected)
    }
  })
})
