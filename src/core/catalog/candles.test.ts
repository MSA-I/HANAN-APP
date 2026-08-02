/**
 * Which candle props offer a candle-colour picker, and — just as deliberately —
 * which do not.
 *
 * The slot only works because `tools/glb-prep/split-candles.mjs` cut a second
 * primitive out of the GLB and named its material `candle`. That split is a
 * MEASUREMENT, not a decision: the tool refuses, loudly and with exit code 1, on a
 * model whose wax and holder read as the same colour. Five of the ten candle props
 * are refused, and this file records the refusal so that wiring one of them up in a
 * later round has to break a test rather than ship a candelabra that repaints
 * itself when the user picks a candle colour.
 *
 * The out-of-scope list is therefore an ASSERTION ABOUT THE ASSETS, and the way to
 * change it is to re-export the model with a distinguishable candle and re-run the
 * splitter — not to add the slot here.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry } from './registry'
import { editableSlotsOf, isEditableSlot } from './types'

/** The five the splitter separated, with the wax colour it measured in the same run. */
const SPLIT: ReadonlyArray<readonly [string, string]> = [
  ['decor.candleholders-wood', '#f8f8f6'],
  ['decor.candlestick-wood', '#d1ebf2'],
  ['decor.candelabrum-gold', '#929190'],
  ['decor.candelabrum-golden', '#a0a2a2'],
  ['decor.candlestick-brass', '#bcb8b6'],
]

/**
 * The five the splitter refused, each with the group separation it measured against
 * the 0.150 threshold. Four are crystal or glass, where the candle is the same white
 * as the vessel; the fifth is a gilt candlestick whose ivory candle is the same warm
 * tone as its stem.
 */
const REFUSED: ReadonlyArray<readonly [string, number]> = [
  ['decor.candelabra-crystal', 0.051],
  ['decor.candleholder-crystal-a', 0.02],
  ['decor.candleholder-crystal-b', 0.072],
  ['decor.candleholders-glass', 0.052],
  ['decor.candlestick-gold', 0.088],
]

describe('the candle colour slot', () => {
  it.each(SPLIT)('%s offers exactly one editable slot, matching the `candle` material', (id) => {
    const entry = getCatalogEntry(id)
    const slots = editableSlotsOf(entry)
    expect(slots).toHaveLength(1)
    expect(slots[0].slot).toBe('candle')
    expect(slots[0].match).toBe('candle')
    expect(isEditableSlot(entry, 'candle')).toBe(true)
    // the holder is NOT editable — setAppearance refuses it, which is what keeps
    // the brass brass while the candle changes colour
    expect(isEditableSlot(entry, 'body')).toBe(false)
  })

  it.each(SPLIT)('%s declares the measured wax colour on a free-picker slot', (id, waxColor) => {
    const slot = getCatalogEntry(id).materialSlots.find((s) => s.name === 'candle')
    expect(slot).toBeDefined()
    expect(slot?.labelKey).toBe('candle')
    // measured by split-candles.mjs, so an untouched candle keeps its own look
    expect(slot?.defaultColor).toBe(waxColor)
    // a candle is matched to the event, not picked from the house palette
    expect(slot?.allowCustomColor).toBe(true)
  })

  it.each(REFUSED)('%s has NO candle slot — separation %f is under the 0.150 gate', (id) => {
    const entry = getCatalogEntry(id)
    expect(editableSlotsOf(entry)).toHaveLength(0)
    expect(entry.materialSlots.some((s) => s.name === 'candle')).toBe(false)
  })

  /**
   * `overrideForPart` is first-match-wins (viewer3d/appearance.ts), so a slot with
   * no `match` listed first would swallow every part of the model — the candle
   * override would repaint the holder. Nothing today puts two slots on these
   * entries; this is the test that fires on the day something does.
   */
  it.each(SPLIT)('%s never lists a match-less slot first', (id) => {
    const slots = editableSlotsOf(getCatalogEntry(id))
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0].match).toBeDefined()
    expect(slots.findIndex((s) => s.match === undefined)).toBe(-1)
  })

  /**
   * Gate 4 of the plan: the four `tableDesigns` centrepieces were run through
   * --measure before anything was wired, and all four were refused — two are glass
   * for their whole length, one has no candle at all (the orchid: the rule claimed
   * 61.8% of the model, its white flowers), and the crystal candelabrum yielded a
   * single 1.8 cm component. None of them may carry the slot.
   */
  it.each([
    'design.candelabrum-crystal',
    'design.lamp-glass-rod',
    'design.orchid-sculpture',
    'design.candelabrum-hurricane',
  ])('%s was measured and refused, so it carries no candle slot', (id) => {
    expect(editableSlotsOf(getCatalogEntry(id))).toHaveLength(0)
  })
})
