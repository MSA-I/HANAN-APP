/**
 * The measurement readouts.
 *
 * The metres half has one hard requirement: it must print what
 * `editor2d/OverlayLayer.tsx` and `ui/StatusBar.tsx` print today, to the
 * character, because adopting it must not shift a single readout. So the tests
 * below restate `(cm / 100).toFixed(2)` as the oracle rather than listing
 * hand-picked expectations — including the places `toFixed` is odd about halves,
 * which are reproduced on purpose and not smoothed over.
 *
 * The one deliberate difference is the signed zero, and it gets its own case.
 */
import { describe, expect, it } from 'vitest'
import { degreesValue, metersValue } from './format'

/** Exactly the expression that lives at OverlayLayer.tsx:13 and StatusBar.tsx:85. */
const asWrittenToday = (cm: number) => (cm / 100).toFixed(2)

describe('metres', () => {
  it('prints two decimals', () => {
    expect(metersValue(0)).toBe('0.00')
    expect(metersValue(250)).toBe('2.50')
    expect(metersValue(100)).toBe('1.00')
    expect(metersValue(4000)).toBe('40.00')
    expect(metersValue(-250)).toBe('-2.50')
  })

  it('matches the two hand-written sites it replaces', () => {
    for (let cm = -5000; cm <= 5000; cm += 37) {
      expect(metersValue(cm)).toBe(asWrittenToday(cm))
    }
  })

  /**
   * The cursor readout updates on every mouse move, and a third of a millimetre
   * left of the origin is -0.004 m — which `toFixed(2)` writes `-0.00`. A minus
   * in front of a zero reads as a rendering fault, not as precision.
   */
  it('never prints a signed zero', () => {
    expect(asWrittenToday(-0.4)).toBe('-0.00') // what it used to do…
    expect(metersValue(-0.4)).toBe('0.00') // …and what it does now
    expect(metersValue(-0)).toBe('0.00')
    expect(metersValue(-0.049)).toBe('0.00')
    for (let cm = -0.49; cm < 0; cm += 0.01) expect(metersValue(cm)).toBe('0.00')
  })

  /**
   * `toFixed` rounds the DOUBLE, not the decimal, so 1.5 cm (0.015 m, stored a
   * hair under) rounds down while 0.5 cm (0.005 m, stored a hair over) rounds up.
   * Pinned rather than fixed: the two sites this replaces have printed exactly
   * this since round 1, and "the badge changed by a centimetre" is not a change
   * anyone asked for.
   */
  it('reproduces toFixed at the half-centimetre, oddities included', () => {
    expect(metersValue(0.5)).toBe('0.01')
    expect(metersValue(1.5)).toBe('0.01')
    expect(metersValue(2.5)).toBe('0.03')
    expect(metersValue(0.4)).toBe('0.00')
    expect(metersValue(0.6)).toBe('0.01')
    for (const cm of [0.5, 1.5, 2.5, 3.5, 12.5]) expect(metersValue(cm)).toBe(asWrittenToday(cm))
  })

  it('survives a non-finite value instead of printing NaN at the user', () => {
    expect(metersValue(NaN)).toBe('0.00')
    expect(metersValue(Infinity)).toBe('0.00')
  })
})

describe('degrees', () => {
  it('drops a trailing zero so a snapped angle reads as a whole number', () => {
    expect(degreesValue(0)).toBe('0')
    expect(degreesValue(45)).toBe('45')
    expect(degreesValue(315)).toBe('315')
  })

  it('keeps one decimal for a freely rotated angle', () => {
    expect(degreesValue(37.3)).toBe('37.3')
    expect(degreesValue(0.5)).toBe('0.5')
    expect(degreesValue(-12.4)).toBe('-12.4')
  })

  /** core/rotation.ts documents where these come from — they must not reach the UI. */
  it('swallows the float noise a free rotation carries', () => {
    expect(degreesValue(37.30000000000001)).toBe('37.3')
    expect(degreesValue(200.04999999999995)).toBe('200')
    expect(degreesValue(0.10000000000002274)).toBe('0.1')
  })

  it('never prints a signed zero', () => {
    expect(degreesValue(-0)).toBe('0')
    expect(degreesValue(-0.04)).toBe('0')
    expect(degreesValue(-0.06)).toBe('-0.1') // a real tenth of a degree still shows
  })

  /** A table at 359.96° has not turned all the way round; "360°" says it has. */
  it('prints just-short-of-a-turn as 0, not 360', () => {
    expect(degreesValue(359.96)).toBe('0')
    expect(degreesValue(359.94)).toBe('359.9')
    expect(degreesValue(360)).toBe('360') // an exact 360 is the caller's to normalise
  })

  it('leaves an un-normalised angle visible rather than wrapping it', () => {
    expect(degreesValue(400)).toBe('400')
    expect(degreesValue(-90)).toBe('-90')
  })

  it('survives a non-finite value', () => {
    expect(degreesValue(NaN)).toBe('0')
    expect(degreesValue(-Infinity)).toBe('0')
  })
})
