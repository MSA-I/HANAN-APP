import { describe, expect, it } from 'vitest'
import { listCatalog } from './catalog/registry'
import { PLAN_FILL_WHITEN, planFill } from './planColor'

/** Perceived lightness, 0 (black) … 1 (white). */
function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}

/** Every colour the catalog can hand FootprintPartShape, deduped. */
const catalogColors = [
  ...new Set(listCatalog().flatMap((e) => e.materialSlots.map((s) => s.defaultColor))),
]

describe('planFill', () => {
  it('leaves white alone and washes black to the mix value', () => {
    expect(planFill('#ffffff')).toBe('#ffffff')
    // 0 + 255 × 0.82 = 209.1 → 0xd1
    expect(planFill('#000000')).toBe('#d1d1d1')
  })

  it('is the identity at amount 0 and full white at amount 1', () => {
    expect(planFill('#57534e', 0)).toBe('#57534e')
    expect(planFill('#57534e', 1)).toBe('#ffffff')
  })

  it('expands three-digit hex', () => {
    expect(planFill('#000', 0)).toBe('#000000')
    expect(planFill('#abc', 0)).toBe('#aabbcc')
  })

  it('reads opaque rgb()/rgba() the same as the equivalent hex', () => {
    expect(planFill('rgb(87, 83, 78)')).toBe(planFill('#57534e'))
    expect(planFill('rgba(87, 83, 78, 1)')).toBe(planFill('#57534e'))
  })

  it('returns a translucent colour untouched — it is already carrying a meaning', () => {
    // the placing ghost's illegal-drop tint (editor2d/OverlayLayer.tsx)
    expect(planFill('rgba(214,69,69,0.25)')).toBe('rgba(214,69,69,0.25)')
    expect(planFill('#57534e80')).toBe('#57534e80')
  })

  it('returns anything it cannot read opaquely untouched', () => {
    expect(planFill('rebeccapurple')).toBe('rebeccapurple')
    expect(planFill('')).toBe('')
  })

  it('washes every real catalog colour to a plan tint', () => {
    expect(catalogColors.length).toBeGreaterThan(1)
    for (const c of catalogColors) expect(luma(planFill(c))).toBeGreaterThan(0.8)
  })

  it('is a true linear mix, so a darker catalog colour stays the darker tint', () => {
    for (const c of catalogColors) {
      const expected = (1 - PLAN_FILL_WHITEN) * luma(c) + PLAN_FILL_WHITEN
      expect(luma(planFill(c))).toBeCloseTo(expected, 2)
    }
  })
})
