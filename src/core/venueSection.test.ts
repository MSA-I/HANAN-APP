import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseVenueSection } from './venueSection'
import { VENUE_PACKS } from './venuePacks'

describe('parseVenueSection', () => {
  it('keeps a well-formed line', () => {
    const s = parseVenueSection({ lines: [{ closed: true, pts: [[0, 0], [10, 0], [10, 5]] }] })
    expect(s?.lines).toHaveLength(1)
    expect(s?.lines[0].closed).toBe(true)
    expect(s?.lines[0].pts).toEqual([[0, 0], [10, 0], [10, 5]])
  })

  it('returns null for anything that is not a section', () => {
    expect(parseVenueSection(null)).toBeNull()
    expect(parseVenueSection('nope')).toBeNull()
    expect(parseVenueSection({})).toBeNull()
    expect(parseVenueSection({ lines: 'nope' })).toBeNull()
    expect(parseVenueSection({ lines: [] })).toBeNull()
  })

  it('drops non-finite coordinates instead of passing them to the canvas', () => {
    // the failure this guards: Konva accepts NaN, draws nothing, and every
    // comparison against NaN is false, so a range check would not catch it
    const s = parseVenueSection({
      lines: [{ pts: [[0, 0], [Number.NaN, 5], [10, 10], [1, Infinity]] }],
    })
    expect(s?.lines[0].pts).toEqual([[0, 0], [10, 10]])
  })

  it('drops a line left with fewer than two points', () => {
    expect(parseVenueSection({ lines: [{ pts: [[0, 0]] }] })).toBeNull()
    expect(parseVenueSection({ lines: [{ pts: [[0, 0], ['x', 'y']] }] })).toBeNull()
  })

  it('refuses to call a two-point run closed — a segment has no area to fill', () => {
    const s = parseVenueSection({ lines: [{ closed: true, pts: [[0, 0], [10, 0]] }] })
    expect(s?.lines[0].closed).toBe(false)
  })
})

describe('the resort section asset', () => {
  const pack = VENUE_PACKS.find((p) => p.id === 'resort')!

  it('is declared by the pack and parses', () => {
    expect(pack.section).toBeTruthy()
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../public${pack.section}`, import.meta.url)), 'utf8'),
    )
    const section = parseVenueSection(raw)
    expect(section).not.toBeNull()
    // the cut is the building, so it has to be substantial — a handful of lines
    // would mean the cut plane missed the walls
    expect(section!.lines.length).toBeGreaterThan(50)
    expect(section!.lines.some((l) => l.closed)).toBe(true)
  })

  it('every line reaches the pack rectangle', () => {
    // NOT "every point is inside it". The venue model carries the rest of the
    // building and a desert backdrop, and a perimeter wall straddles the floor
    // edge — its outer face is legitimately outside. What must hold is that
    // nothing is drawn wholly out in space, which is what --clip enforces, and
    // it drops whole polylines because clipping one open would turn a wall loop
    // into a line and it would stop drawing as poché.
    const raw = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../public${pack.section}`, import.meta.url)), 'utf8'),
    )
    const section = parseVenueSection(raw)!
    for (const line of section.lines) {
      const xs = line.pts.map((p) => p[0])
      const ys = line.pts.map((p) => p[1])
      expect(Math.max(...xs)).toBeGreaterThanOrEqual(0)
      expect(Math.min(...xs)).toBeLessThanOrEqual(pack.size.width)
      expect(Math.max(...ys)).toBeGreaterThanOrEqual(0)
      expect(Math.min(...ys)).toBeLessThanOrEqual(pack.size.depth)
    }
  })
})
