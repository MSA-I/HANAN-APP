/**
 * The mapping from a catalogue slot onto a GLB part, exercised on the case that
 * makes it load-bearing: a candle holder whose wax is one primitive and whose metal
 * is another.
 *
 * `appearance.ts` imports no `three` on purpose — that is what lets vitest cover it
 * under `environment: 'node'` — so everything the renderer decides about WHICH part
 * wears WHICH override is testable here, and only the material clone itself lives in
 * ObjectGroup.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { isEditableSlot } from '../core/catalog/types'
import { overrideForPart, slotAppearances } from './appearance'

const holder = () => getCatalogEntry('decor.candleholders-wood')

describe('slotAppearances on a split candle prop', () => {
  it('asks for nothing until the user picks a colour', () => {
    // ⚠ NOT the slot's `defaultColor`. That number is the wax's own measured mean,
    // and writing it onto a cloned material would multiply the baked texture by
    // itself. Undefined is what makes ObjectGroup return the shared sentinel.
    expect(slotAppearances(holder(), {})).toEqual([
      { match: 'candle', color: undefined, textureId: null },
    ])
  })

  it('carries the user pick through, and no texture with it', () => {
    expect(slotAppearances(holder(), { candle: { color: '#c62828' } })).toEqual([
      { match: 'candle', color: '#c62828', textureId: null },
    ])
  })

  it('ignores an override aimed at a slot the entry does not expose', () => {
    // `body` is a real materialSlot (the 2D footprint uses it) but not an editable
    // one, so it never reaches the renderer
    expect(slotAppearances(holder(), { body: { color: '#ff0000' } })).toEqual([
      { match: 'candle', color: undefined, textureId: null },
    ])
    expect(isEditableSlot(holder(), 'body')).toBe(false)
  })
})

describe('overrideForPart', () => {
  const slots = slotAppearances(holder(), { candle: { color: '#1a237e' } })

  it('gives the candle material the override', () => {
    expect(overrideForPart('candle', slots)?.color).toBe('#1a237e')
  })

  it('leaves every Tripo-named part alone, which is how the holder keeps its bake', () => {
    // the other primitive still wears the name glb-prep left on it
    expect(overrideForPart('tripo_mat_5bd96be0-2fce-4dbf-9d6e-de4398952de0', slots)).toBeUndefined()
    expect(overrideForPart('', slots)).toBeUndefined()
  })

  it('matches on PREFIX, so a suffixed re-export still lands', () => {
    expect(overrideForPart('candle-00', slots)?.color).toBe('#1a237e')
  })

  it('hands a refused model no slot at all', () => {
    // decor.candlestick-gold has no editableSlots — its candle and its stem are the
    // same warm tone and split-candles.mjs refused it
    const none = slotAppearances(getCatalogEntry('decor.candlestick-gold'), { candle: { color: '#c62828' } })
    expect(none).toEqual([])
    expect(overrideForPart('candle', none)).toBeUndefined()
  })
})
