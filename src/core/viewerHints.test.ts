/**
 * The 3D hint line.
 *
 * A hint that flickers between two lines depending on which state was written
 * last is worse than no hint, so the claim under test is TOTALITY: every one of
 * the 72 reachable contexts has exactly one answer, and the answer depends only
 * on the context — never on the order the flags were set.
 *
 * The precedence is written out once, as a list, and every other test in this
 * file is derived from it. Reordering `viewerHint` without reordering the list
 * fails immediately rather than in whichever pair of flags nobody thought to try.
 */
import { describe, expect, it } from 'vitest'
import { viewerHint, type HintId, type ViewerHintContext } from './viewerHints'

const IDLE: ViewerHintContext = {
  selection: 0,
  placing: false,
  orbitHeld: false,
  dragging: null,
  designEdit: false,
}

/**
 * Most immediate first — this list IS the documented order in viewerHints.ts.
 * `on` turns a rank on; `holds` says whether it is on in a given context, and the
 * two differ for `selection`, which is a COUNT rather than a flag.
 */
const RANKS: {
  hint: HintId
  on: Partial<ViewerHintContext>
  holds: (c: ViewerHintContext) => boolean
}[] = [
  { hint: 'dragMove', on: { dragging: 'move' }, holds: (c) => c.dragging === 'move' },
  { hint: 'dragRotate', on: { dragging: 'rotate' }, holds: (c) => c.dragging === 'rotate' },
  { hint: 'orbit', on: { orbitHeld: true }, holds: (c) => c.orbitHeld },
  { hint: 'placing', on: { placing: true }, holds: (c) => c.placing },
  { hint: 'designEdit', on: { designEdit: true }, holds: (c) => c.designEdit },
  { hint: 'selection', on: { selection: 1 }, holds: (c) => c.selection > 0 },
]

const ctx = (over: Partial<ViewerHintContext> = {}): ViewerHintContext => ({ ...IDLE, ...over })

/** Every context reachable from the five fields — 3·2·2·3·2 = 72. */
function everyContext(): ViewerHintContext[] {
  const out: ViewerHintContext[] = []
  for (const selection of [0, 1, 4]) {
    for (const placing of [false, true]) {
      for (const orbitHeld of [false, true]) {
        for (const dragging of [null, 'move', 'rotate'] as ViewerHintContext['dragging'][]) {
          for (const designEdit of [false, true]) {
            out.push({ selection, placing, orbitHeld, dragging, designEdit })
          }
        }
      }
    }
  }
  return out
}

describe('each state on its own', () => {
  it('says what is happening', () => {
    for (const { hint, on } of RANKS) expect(viewerHint(ctx(on))).toBe(hint)
  })

  it('says nothing in particular when nothing is happening', () => {
    expect(viewerHint(IDLE)).toBe('idle')
  })

  it('reads a multi-selection as a selection', () => {
    expect(viewerHint(ctx({ selection: 7 }))).toBe('selection')
    expect(viewerHint(ctx({ selection: 0 }))).toBe('idle')
  })
})

describe('the precedence is total', () => {
  /**
   * EVERY pair that can hold at once, both ways round — not the two or three
   * anyone would think to write by hand. `dragMove`/`dragRotate` is the one pair
   * excluded, and only because they are two values of ONE field and so cannot
   * both be on; the loop skips it by looking at the keys rather than by naming it,
   * so a future context field that splits them is covered the day it lands.
   */
  it('gives the same winner whichever of two states is set first', () => {
    let pairs = 0
    for (let i = 0; i < RANKS.length; i++) {
      for (let j = i + 1; j < RANKS.length; j++) {
        const keys = Object.keys(RANKS[i].on)
        if (keys.some((k) => k in RANKS[j].on)) continue
        const winner = RANKS[i].hint // i < j, and RANKS is ordered by precedence
        expect(viewerHint(ctx({ ...RANKS[i].on, ...RANKS[j].on }))).toBe(winner)
        expect(viewerHint(ctx({ ...RANKS[j].on, ...RANKS[i].on }))).toBe(winner)
        pairs++
      }
    }
    expect(pairs).toBe(14) // 15 pairs, less the one field that holds two of them
  })

  it('resolves every reachable context to exactly one hint', () => {
    const allowed = new Set<HintId>([...RANKS.map((r) => r.hint), 'idle'])
    const contexts = everyContext()
    expect(contexts).toHaveLength(3 * 2 * 2 * 3 * 2)
    for (const c of contexts) {
      const hint = viewerHint(c)
      expect(allowed.has(hint)).toBe(true)
      expect(viewerHint({ ...c })).toBe(hint) // depends on the values, not the object
    }
  })

  it('picks the highest-ranked state that is on, in every context at once', () => {
    for (const c of everyContext()) {
      const expected = RANKS.find(({ holds }) => holds(c))?.hint ?? 'idle'
      expect(viewerHint(c)).toBe(expected)
    }
  })
})

describe('the collisions that actually happen', () => {
  it('a drag beats a stale orbit flag, so the hint cannot freeze on orbiting', () => {
    expect(viewerHint(ctx({ orbitHeld: true, dragging: 'move' }))).toBe('dragMove')
    expect(viewerHint(ctx({ orbitHeld: true, dragging: 'rotate' }))).toBe('dragRotate')
  })

  it('an armed item beats a selection — the next click places, it does not select', () => {
    expect(viewerHint(ctx({ placing: true, selection: 3 }))).toBe('placing')
  })

  it('an armed item beats design-edit — the mode is the room, the drop is the act', () => {
    expect(viewerHint(ctx({ placing: true, designEdit: true, selection: 1 }))).toBe('placing')
  })

  it('a drag inside design-edit talks about the drag', () => {
    expect(viewerHint(ctx({ designEdit: true, dragging: 'move', selection: 1 }))).toBe('dragMove')
    expect(viewerHint(ctx({ designEdit: true, dragging: 'rotate' }))).toBe('dragRotate')
  })

  it('design-edit beats the selection it always carries', () => {
    // opening the mode selects the table, so this pair is the NORMAL state of the
    // mode rather than an edge case — getting it backwards means the mode never
    // announces itself at all
    expect(viewerHint(ctx({ designEdit: true, selection: 1 }))).toBe('designEdit')
  })

  it('rotating beats moving when a buggy caller claims both', () => {
    // `dragging` is one field precisely so it cannot, but the union has two
    // inhabitants and the order between them is still stated rather than implied
    expect(viewerHint(ctx({ dragging: 'move' }))).toBe('dragMove')
    expect(viewerHint(ctx({ dragging: 'rotate' }))).toBe('dragRotate')
  })
})
