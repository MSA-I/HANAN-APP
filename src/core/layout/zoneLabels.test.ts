import { describe, expect, it } from 'vitest'
import {
  formatElevation,
  labelBoxesOverlap,
  labelFits,
  LABEL_BASE_HEIGHT,
  LABEL_ELEVATION_HEIGHT,
  LTR_ISOLATE,
  POP_ISOLATE,
  zoneLabelBoxes,
  type ZoneLabelBox,
} from './zoneLabels'
import { getVenuePack, type RestrictedZone } from '../venuePacks'

// the real hall, not a hand-written copy of it (BRIEF §1.7)
const resort = getVenuePack('resort')!
const zones = resort.restricted!

const inside = (box: ZoneLabelBox, z: RestrictedZone) =>
  box.x >= z.x && box.y >= z.y && box.x + box.w <= z.x + z.width && box.y + box.h <= z.y + z.depth

/** what the layer used to do: centre the tag in its zone, and hope */
const centred = (z: RestrictedZone, w: number, h: number): ZoneLabelBox => ({
  kind: z.kind ?? '',
  x: z.x + (z.width - w) / 2,
  y: z.y + (z.depth - h) / 2,
  w,
  h,
})

describe('zoneLabelBoxes on the resort pack', () => {
  const boxes = zoneLabelBoxes(zones)

  it('returns one box per zone, in input order', () => {
    expect(boxes).toHaveLength(zones.length)
    expect(boxes.map((b) => b.kind)).toEqual(zones.map((z) => z.kind))
  })

  it('leaves no pair of tags overlapping', () => {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const clash = labelBoxesOverlap(boxes[i], boxes[j])
        expect(`${boxes[i].kind}×${boxes[j].kind}: ${clash}`).toBe(`${boxes[i].kind}×${boxes[j].kind}: false`)
      }
    }
  })

  it('keeps every tag inside its own zone', () => {
    boxes.forEach((box, i) => {
      expect(inside(box, zones[i])).toBe(true)
    })
  })

  it('gives an elevated zone a second line and a flat one a single line', () => {
    const chuppah = boxes[zones.findIndex((z) => z.kind === 'chuppah')]
    const pool = boxes[zones.findIndex((z) => z.kind === 'pool')]
    expect(chuppah.h).toBe(LABEL_BASE_HEIGHT + LABEL_ELEVATION_HEIGHT)
    expect(pool.h).toBe(LABEL_BASE_HEIGHT)
  })

  it('still nests the chuppah inside the pool, and now both tags fit centred', () => {
    const pool = zones.findIndex((z) => z.kind === 'pool')
    const chuppah = zones.findIndex((z) => z.kind === 'chuppah')
    // The nesting itself is load-bearing — venuePacks orders `restricted` around
    // it — so assert it rather than assume it survived the re-import.
    const p = zones[pool], c = zones[chuppah]
    expect(
      c.x >= p.x && c.y >= p.y && c.x + c.width <= p.x + p.width && c.y + c.depth <= p.y + p.depth,
    ).toBe(true)

    // Source doc §17 was demonstrated on this pair: `pool` used to start at y 1408
    // and its centred tag landed 29cm off the chuppah's, so the layout had to push
    // the pool tag out of the way. The 19:47 re-import narrowed `pool` to the water
    // alone (y 1611…2544), dropping its centre 101cm and opening ~131cm between the
    // two — so neither tag has to move now, and both keep the centred slot.
    // The displacement branch itself is covered, geometry-independently, by
    // 'zoneLabelBoxes on full containment' below.
    const naive = zones.map((z, i) => centred(z, boxes[i].w, boxes[i].h))
    expect(labelBoxesOverlap(naive[pool], naive[chuppah])).toBe(false)
    expect(naive[pool].y - (naive[chuppah].y + naive[chuppah].h)).toBeGreaterThan(100)
    expect(boxes[chuppah]).toEqual(naive[chuppah])
    expect(boxes[pool]).toEqual(naive[pool])
  })

  it('is deterministic', () => {
    expect(zoneLabelBoxes(zones)).toEqual(boxes)
  })
})

describe('zoneLabelBoxes on full containment', () => {
  // the shape of the §17 bug, isolated: a small zone entirely inside a big one
  const outer: RestrictedZone = { x: 0, y: 0, width: 1000, depth: 1000, kind: 'outer' }
  const inner: RestrictedZone = { x: 400, y: 400, width: 200, depth: 200, kind: 'inner' }

  it('separates the two tags a centred layout would stack', () => {
    const [outerBox, innerBox] = zoneLabelBoxes([outer, inner])
    // proof the case is real: centred, the two boxes sit on each other
    expect(
      labelBoxesOverlap(centred(outer, outerBox.w, outerBox.h), centred(inner, innerBox.w, innerBox.h)),
    ).toBe(true)
    // solved
    expect(labelBoxesOverlap(outerBox, innerBox)).toBe(false)
    expect(inside(outerBox, outer)).toBe(true)
    expect(inside(innerBox, inner)).toBe(true)
    // the small zone kept the centre; the big one moved
    expect(innerBox).toEqual(centred(inner, innerBox.w, innerBox.h))
  })

  it('does not depend on the order the zones arrive in', () => {
    const [outerBox, innerBox] = zoneLabelBoxes([outer, inner])
    const [innerFirst, outerFirst] = zoneLabelBoxes([inner, outer])
    expect(outerFirst).toEqual(outerBox)
    expect(innerFirst).toEqual(innerBox)
  })

  it('falls back to the least-bad slot when a zone has nowhere clear to go', () => {
    // Three identical stacked zones: three 380×60 tags cannot sit in one 500×120
    // zone without touching, so for two of them NO candidate is clear and the
    // minimum-overlap branch is the only way out. This is the test that enters it.
    const same: RestrictedZone = { x: 0, y: 0, width: 500, depth: 120, kind: 'a' }
    const boxes = zoneLabelBoxes([same, { ...same, kind: 'b' }, { ...same, kind: 'c' }])
    expect(boxes).toHaveLength(3)
    // it degrades, it does not throw and does not drop a label
    boxes.forEach((b) => expect(inside(b, same)).toBe(true))
    // proof the branch ran: a clear slot would mean no overlap at all
    const clashes = boxes.filter((b, i) => boxes.some((o, j) => j > i && labelBoxesOverlap(b, o)))
    expect(clashes.length).toBeGreaterThan(0)
    // and it spread them to the extremes rather than stacking all three
    expect(new Set(boxes.map((b) => `${b.x},${b.y}`)).size).toBe(3)
  })
})

describe('formatElevation', () => {
  /** what a reader actually sees: the isolates are zero-width and never drawn */
  const bare = (s: string) => s.split(LTR_ISOLATE).join('').split(POP_ISOLATE).join('')

  it('writes the level mark the way a plan does', () => {
    expect(bare(formatElevation(470))).toBe('+4.70')
    expect(bare(formatElevation(50))).toBe('+0.50')
    expect(bare(formatElevation(0))).toBe('+0.00')
    expect(bare(formatElevation(-120))).toBe('-1.20')
  })

  it('isolates the mark so the RTL page cannot flip the sign to the right', () => {
    // The regression this pins: the app is dir="rtl", the Konva canvas inherits
    // it, and `+4.70` came out of fillText as `4.70+` — photographed under
    // "קבלת פנים". Asserting the digits alone would not have caught it.
    const s = formatElevation(470)
    expect(s).toBe(`${LTR_ISOLATE}+4.70${POP_ISOLATE}`)
    expect(s.startsWith(LTR_ISOLATE)).toBe(true)
    expect(s.endsWith(POP_ISOLATE)).toBe(true)
    // the sign is the FIRST visible character, which is the whole point
    expect(bare(s)[0]).toBe('+')
    expect(bare(formatElevation(-120))[0]).toBe('-')
  })

  it('adds no visible characters — the isolates are zero-width formatters', () => {
    expect(bare(formatElevation(470))).toHaveLength(5)
    expect(formatElevation(470)).toHaveLength(7)
  })

  it('matches the elevations the pack actually carries', () => {
    const kabalat = zones.find((z) => z.kind === 'kabalatPanim')!
    const chuppah = zones.find((z) => z.kind === 'chuppah')!
    expect(bare(formatElevation(kabalat.elevation!))).toBe('+4.70')
    expect(bare(formatElevation(chuppah.elevation!))).toBe('+0.50')
  })
})

describe('labelFits', () => {
  const box = (w: number, h: number): ZoneLabelBox => ({ kind: 'x', x: 0, y: 0, w, h })

  it('refuses a box too narrow to hold a word', () => {
    // a 44 cm tag needs 132 cm of width before it is worth drawing
    expect(labelFits(box(131, 60), 44)).toBe(false)
    expect(labelFits(box(132, 60), 44)).toBe(true)
    expect(labelFits(box(400, 43), 44)).toBe(false)
  })

  it('rejects exactly the pool-side strips that used to print a bare ellipsis', () => {
    // the failure: two 120 cm `saviv` rectangles flank the pool, their tag boxes
    // come out ~88 cm wide, and Konva's `ellipsis` rendered "…" on the drawing
    const boxes = zoneLabelBoxes(zones)
    const narrow = zones
      .map((z, i) => ({ z, box: boxes[i] }))
      .filter(({ box }) => !labelFits(box, 44))
    expect(narrow.length).toBeGreaterThan(0)
    for (const { box } of narrow) expect(box.w).toBeLessThan(132)
    // …and the rooms that matter keep their names
    for (const kind of ['pool', 'dancefloor', 'kabalatPanim']) {
      const i = zones.findIndex((z) => z.kind === kind)
      expect(labelFits(boxes[i], 44)).toBe(true)
    }
  })
})
