import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseVenueCut } from './venueCut'
import { getVenuePack } from './venuePacks'

/**
 * The shipped asset, read off disk. A parser test on invented input proves the
 * parser; this proves the DRAWING — that the file the app fetches is the file the
 * extractor wrote, in the frame the zones use. The 2D view is not reachable from
 * vitest (node environment, AGENT-BRIEF §1.7), so this is the only place the wall
 * data can be checked at all.
 */
const resort = getVenuePack('resort')!
const asset = JSON.parse(
  readFileSync(`public${resort.cut!}`, 'utf8'),
) as unknown

describe('the resort walls', () => {
  it('parses, and is a wall traced by hand rather than a handful of stubs', () => {
    const cut = parseVenueCut(asset)!
    expect(cut).not.toBeNull()
    // the painted trace came back as thousands of triangles; a two-digit count
    // would mean the material was picked up on almost nothing
    expect(cut.tris.length).toBeGreaterThan(1000)
  })

  it('lands in the plan frame the zones are in', () => {
    const cut = parseVenueCut(asset)!
    const xs = cut.tris.flatMap((t) => [t[0], t[2], t[4]])
    const ys = cut.tris.flatMap((t) => [t[1], t[3], t[5]])
    const deck = resort.restricted!.find((z) => z.kind === 'kabalatPanim')!
    // the walls must reach the far side of the deck: same origin, same units,
    // and a factor-of-100 slip or a different origin would fail here
    expect(Math.max(...xs)).toBeGreaterThan(deck.x + deck.width - 200)
    expect(Math.min(...xs)).toBeLessThan(200)
    // ⚠ the building is NOT inside the venue rectangle. The north wall sits above
    // the plan origin, which is why the PNG export carries a margin (Stage2D).
    expect(Math.min(...ys)).toBeLessThan(0)
  })

  /**
   * The data fact that VenueLayer's all-or-nothing decision rests on.
   *
   * ZONE_CUT is ONE marker over the whole building, so the poché is drawn with
   * the hall and hidden with it. That is only tolerable because the deck's share
   * of the wall is a minority of it — a real loss, worth stating, but not the
   * drawing. If the user ever paints the reception its own marker, this count
   * moves and the test fires, which is exactly when the split stops being an
   * invention and becomes data.
   */
  it('puts a real minority of the wall inside the reception deck', () => {
    const cut = parseVenueCut(asset)!
    const deck = resort.restricted!.find((z) => z.kind === 'kabalatPanim')!
    const inside = cut.tris.filter((t) => {
      const cx = (t[0] + t[2] + t[4]) / 3
      const cy = (t[1] + t[3] + t[5]) / 3
      return cx >= deck.x && cx <= deck.x + deck.width && cy >= deck.y && cy <= deck.y + deck.depth
    })
    // measured 2026-07-30 on the shipped asset: 431 of 4,640 triangles,
    // 9.8 m² of 28.5 m² of painted wall
    expect(inside.length).toBeGreaterThan(100)
    expect(inside.length).toBeLessThan(cut.tris.length / 2)
  })
})

describe('parseVenueCut', () => {
  it('drops a triangle with a coordinate that cannot be drawn', () => {
    // Konva takes NaN, draws nothing, and every comparison against it is false —
    // so this has to be caught here or not at all
    const cut = parseVenueCut({
      tris: [
        [0, 0, 10, 0, 10, 10],
        [0, 0, Number.NaN, 0, 10, 10],
        [0, 0, 10, 0],
        'not a triangle',
      ],
    })
    expect(cut?.tris).toEqual([[0, 0, 10, 0, 10, 10]])
  })

  it('is null for a payload with nothing drawable in it, so the plan still opens', () => {
    expect(parseVenueCut(null)).toBeNull()
    expect(parseVenueCut({})).toBeNull()
    expect(parseVenueCut({ tris: [] })).toBeNull()
    expect(parseVenueCut({ tris: [[0, 0, Number.POSITIVE_INFINITY, 0, 1, 1]] })).toBeNull()
  })
})
