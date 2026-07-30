/**
 * The inspector's collapse state, read back from one localStorage key.
 *
 * Everything here is about ONE claim: a stored blob can never break the panel.
 * It is user-visible data living outside the schema — no migration runs over it,
 * no validator guards it, and a build that renames a section ships against saves
 * written by the build before it. So the tests are mostly hostile inputs, and the
 * expected answer to all of them is the same: fall back, render, say nothing.
 */
import { describe, expect, it } from 'vitest'
import { resolveOpenSections } from './panelState'

const DEFAULTS = { transform: true, appearance: false, seating: true }

describe('a usable stored value', () => {
  it('takes the stored answer over the default', () => {
    expect(resolveOpenSections({ transform: false, appearance: true }, DEFAULTS)).toEqual({
      transform: false,
      appearance: true,
      seating: true,
    })
  })

  it('accepts the raw JSON string localStorage hands back', () => {
    const stored = JSON.stringify({ transform: false, appearance: true, seating: false })
    expect(resolveOpenSections(stored, DEFAULTS)).toEqual({
      transform: false,
      appearance: true,
      seating: false,
    })
  })

  it('round-trips its own output', () => {
    const once = resolveOpenSections({ appearance: true }, DEFAULTS)
    expect(resolveOpenSections(JSON.stringify(once), DEFAULTS)).toEqual(once)
  })
})

describe('a stored value that is not usable', () => {
  it('falls back for nothing saved, malformed JSON, and the wrong shape', () => {
    const hostile: unknown[] = [
      null,
      undefined,
      '',
      '{',
      '{"transform": tru}',
      'not json at all',
      'null',
      '[]',
      '42',
      [],
      ['transform'],
      42,
      true,
      () => ({ transform: false }),
    ]
    for (const stored of hostile) {
      expect(resolveOpenSections(stored, DEFAULTS)).toEqual(DEFAULTS)
    }
  })

  it('falls back per section, keeping the ones that did parse', () => {
    const stored = { transform: 'yes', appearance: true, seating: null }
    expect(resolveOpenSections(stored, DEFAULTS)).toEqual({
      transform: true, // 'yes' is corrupt, not truthy
      appearance: true,
      seating: true, // null is corrupt, not false
    })
  })

  it('believes only a real boolean', () => {
    for (const value of [1, 0, 'true', 'false', null, undefined, [], {}]) {
      expect(resolveOpenSections({ appearance: value }, DEFAULTS).appearance).toBe(
        DEFAULTS.appearance,
      )
    }
  })
})

describe('the section list is the current build, not the save file', () => {
  it('drops a section the build no longer has', () => {
    const stored = { transform: false, retiredInRound3: true }
    const out = resolveOpenSections(stored, DEFAULTS)
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEFAULTS).sort())
    expect('retiredInRound3' in out).toBe(false)
  })

  it('opens a section added since the save at its default', () => {
    const stored = { transform: false } // written before `seating` existed
    expect(resolveOpenSections(stored, DEFAULTS).seating).toBe(DEFAULTS.seating)
  })

  it('returns an empty record when the build declares no sections', () => {
    expect(resolveOpenSections({ transform: false }, {})).toEqual({})
  })

  /** Inherited keys are not stored preferences — `toString` is not "open". */
  it('does not read anything off Object.prototype', () => {
    const out = resolveOpenSections({}, { toString: true, constructor: false })
    expect(out).toEqual({ toString: true, constructor: false })
  })

  it('never mutates the defaults it was given', () => {
    const defaults = { ...DEFAULTS }
    resolveOpenSections({ transform: false, appearance: true }, defaults)
    expect(defaults).toEqual(DEFAULTS)
  })
})
