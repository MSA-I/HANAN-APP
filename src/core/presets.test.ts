/**
 * Integrity of the preset registries against the catalog and the Hebrew string
 * dictionary. This is the guard for the real-inventory principle: a preset that
 * names an asset the venue does not own must fail here, not in the browser.
 */
import { describe, expect, it } from 'vitest'
import { getCatalogEntry, hasCatalogEntry } from './catalog/registry'
import { computeMaxSeats } from './layout/seatLayout'
import { HALL_DESIGNS, TABLE_DESIGNS, TABLE_PRESETS, presetSeating } from './presets'
import { strings } from '../ui/strings'

const items = strings.presets.items
const known = (labelKey: string) => Object.prototype.hasOwnProperty.call(items, labelKey)

describe('table presets', () => {
  it.each(TABLE_PRESETS)('$id composes real catalog entries', (preset) => {
    expect(hasCatalogEntry(preset.tableCatalogId)).toBe(true)
    expect(hasCatalogEntry(preset.chairCatalogId)).toBe(true)
    const table = getCatalogEntry(preset.tableCatalogId)
    expect(table.category).toBe('tables')
    expect(table.seating).toBeDefined()
    expect(getCatalogEntry(preset.chairCatalogId).category).toBe('seating')
  })

  it.each(TABLE_PRESETS)('$id asks for a seat count the table can take', (preset) => {
    const table = getCatalogEntry(preset.tableCatalogId)
    const seating = presetSeating(preset)
    const fits = computeMaxSeats(
      table.footprint(table.defaultSize).outline,
      seating,
      getCatalogEntry(preset.chairCatalogId).defaultSize,
    )
    expect(preset.seatCount).toBeGreaterThanOrEqual(table.seating!.min)
    expect(preset.seatCount).toBeLessThanOrEqual(table.seating!.max)
    // a preset that over-asks would silently lose chairs to the reconciler's clamp
    expect(preset.seatCount).toBeLessThanOrEqual(fits)
  })
})

describe('table designs', () => {
  it.each(TABLE_DESIGNS)('$id places only surface decor', (design) => {
    expect(design.items.length).toBeGreaterThan(0)
    for (const item of design.items) {
      expect(hasCatalogEntry(item.catalogId)).toBe(true)
      expect(getCatalogEntry(item.catalogId).placement).toBe('surface')
    }
  })

  it.each(TABLE_DESIGNS)('$id uses a real place setting, if any', (design) => {
    if (!design.seatItem) return
    expect(hasCatalogEntry(design.seatItem)).toBe(true)
    expect(getCatalogEntry(design.seatItem).placement).toBe('seat')
  })

  it.each(TABLE_DESIGNS)('$id keeps its offsets on the smallest table', (design) => {
    // ⌀180 with a ring of place settings leaves ~⌀108 free in the middle
    for (const item of design.items) {
      expect(Math.abs(item.x ?? 0)).toBeLessThanOrEqual(40)
      expect(Math.abs(item.y ?? 0)).toBeLessThanOrEqual(15)
    }
  })
})

describe('hall designs', () => {
  it.each(HALL_DESIGNS)('$id hangs a real ceiling fixture', (design) => {
    expect(hasCatalogEntry(design.catalogId)).toBe(true)
    expect(getCatalogEntry(design.catalogId).placement).toBe('ceiling')
    expect(design.spacing).toBeGreaterThan(0)
  })
})

describe('registry hygiene', () => {
  const all = [...TABLE_PRESETS, ...TABLE_DESIGNS, ...HALL_DESIGNS]

  it('every entry has a Hebrew label', () => {
    const missing = all.filter((e) => !known(e.labelKey)).map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('ids are unique across all three registries', () => {
    const ids = all.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no orphan strings', () => {
    const used = new Set(all.map((e) => e.labelKey))
    expect(Object.keys(items).filter((k) => !used.has(k))).toEqual([])
  })
})
