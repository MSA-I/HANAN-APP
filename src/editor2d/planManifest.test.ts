/**
 * The contract between tools/topdown-prep.mjs and ObjectNode. A missing or
 * mis-scaled row does not throw at runtime — the object just quietly falls back
 * to its vector footprint or draws at the wrong size — so the check has to live
 * here.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listCatalog } from '../core/catalog/registry'

interface ManifestItem {
  file: string
  cmW: number
  cmD: number
  pxPerCm: number
  w: number
  h: number
}

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../public/plan/manifest.json', import.meta.url)), 'utf8'),
) as { items: Record<string, ManifestItem>; failed?: string[]; maxSide: number }

const modelled = listCatalog().filter((e) => e.model)

describe('plan image manifest', () => {
  it('rendered every prop it was asked to', () => {
    expect(manifest.failed ?? []).toEqual([])
  })

  it('covers every catalog entry that declares a GLB', () => {
    const missing = modelled.filter((e) => !manifest.items[e.model!]).map((e) => e.id)
    expect(missing).toEqual([])
  })

  it('stays inside the size budget the drawing side assumes', () => {
    for (const [model, item] of Object.entries(manifest.items)) {
      expect(item.cmW, model).toBeGreaterThan(0)
      expect(item.cmD, model).toBeGreaterThan(0)
      expect(Math.max(item.w, item.h), model).toBeLessThanOrEqual(manifest.maxSide)
    }
  })

  /**
   * ObjectNode draws `cmW × size.width/defaultSize.width × modelScale`. If the
   * GLB's real footprint and the catalog's declared default disagree, that is
   * what shows up as a 2D shape that does not match the 3D one — the exact
   * failure this plan exists to fix. The bound is loose on purpose: it is here
   * to catch a unit slip or a dropped modelScale, not to police the catalog,
   * which PLAN-01 owns.
   */
  it('draws each entry at roughly its declared default size', () => {
    const off: string[] = []
    for (const entry of modelled) {
      const item = manifest.items[entry.model!]
      if (!item) continue
      const scale = entry.modelScale ?? 1
      const drawnW = item.cmW * scale
      const drawnD = item.cmD * scale
      const ratio = Math.max(
        drawnW / entry.defaultSize.width,
        entry.defaultSize.width / drawnW,
        drawnD / entry.defaultSize.depth,
        entry.defaultSize.depth / drawnD,
      )
      if (ratio > 1.6) {
        off.push(
          `${entry.id}: drawn ${drawnW.toFixed(0)}×${drawnD.toFixed(0)} cm ` +
            `vs default ${entry.defaultSize.width}×${entry.defaultSize.depth}`,
        )
      }
    }
    expect(off).toEqual([])
  })
})
