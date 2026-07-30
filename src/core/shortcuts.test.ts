/**
 * The point of `core/shortcuts.ts`: these assertions are what make the printed
 * help mechanically answerable to the bindings instead of being a prose copy of
 * them that quietly rots. Every one of them fails LOUDLY on the kind of edit
 * that has broken the help table three times.
 */
import { describe, expect, it } from 'vitest'
import { SHORTCUTS, chordFor, chordFromCodes, shortcutsFor, tokenFor } from './shortcuts'
import { strings } from '../ui/strings'

/** Walk a dotted path like `help.keys.undoRedo` into the dictionary. */
function resolve(path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[key]
  }, strings)
}

const keyboard = SHORTCUTS.filter((s) => s.codes.length > 0)

describe('the shortcut catalog', () => {
  it('gives every entry a unique id', () => {
    const ids = SHORTCUTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names a labelKey that resolves to a non-empty string', () => {
    for (const s of SHORTCUTS) {
      const label = resolve(s.labelKey)
      expect(typeof label, `${s.id} → ${s.labelKey}`).toBe('string')
      expect((label as string).length, `${s.id} → ${s.labelKey}`).toBeGreaterThan(0)
    }
  })

  it('gives every entry a non-empty chord', () => {
    for (const s of SHORTCUTS) expect(s.chord.length, s.id).toBeGreaterThan(0)
  })

  /**
   * THE invariant. A binding cannot change without the printed chord changing
   * with it — which is exactly the drift that produced a help table describing
   * 15° steps, then an inverted Shift, then a snap that had been removed.
   */
  it('prints a chord that is rederivable from the codes it listens for', () => {
    for (const s of keyboard) {
      expect(s.chord, `${s.id} prints a chord its codes do not produce`).toBe(chordFromCodes(s))
    }
  })

  it('leaves the pointer gestures out of that check by construction', () => {
    // A gesture with no physical key derives to nothing, which is exactly why
    // it is exempt — not because the check was relaxed for it. Its chord is
    // still required to be non-empty by the assertion above.
    const pointer = SHORTCUTS.filter((s) => s.codes.length === 0)
    expect(pointer.length).toBeGreaterThan(0)
    for (const s of pointer) expect(chordFromCodes(s), s.id).toBe('')
  })
})

describe('scope resolution', () => {
  it("hands every 'both' entry to each view", () => {
    const shared = SHORTCUTS.filter((s) => s.scope === 'both')
    expect(shared.length).toBeGreaterThan(0)
    for (const view of ['2d', '3d'] as const) {
      const ids = new Set(shortcutsFor(view).map((s) => s.id))
      for (const s of shared) expect(ids.has(s.id), `${s.id} missing from ${view}`).toBe(true)
    }
  })

  it("adds only that view's own entries on top", () => {
    expect(shortcutsFor('2d').every((s) => s.scope === '2d' || s.scope === 'both')).toBe(true)
    expect(shortcutsFor('3d').every((s) => s.scope === '3d' || s.scope === 'both')).toBe(true)
  })

  it("returns the whole catalog for 'both'", () => {
    expect(shortcutsFor('both')).toHaveLength(SHORTCUTS.length)
  })

  /**
   * Two rows printing the same chord in one table is the user-visible failure:
   * whichever one they read, half the time the app does the other thing. A
   * gesture may legitimately be reused ACROSS views — the 2D middle-drag pans
   * the plan, the 3D one trucks the camera — so this is checked per resolved
   * view, never across the flat catalog.
   */
  it.each(['2d', '3d'] as const)('never prints one chord twice in %s', (view) => {
    const seen = new Map<string, string>()
    for (const s of shortcutsFor(view)) {
      const clash = seen.get(s.chord)
      expect(clash, `${s.id} and ${clash} both print "${s.chord}" in ${view}`).toBeUndefined()
      seen.set(s.chord, s.id)
    }
  })
})

describe('chordFromCodes', () => {
  it('strips the Key/Digit prefix', () => {
    expect(tokenFor('KeyV')).toBe('V')
    expect(tokenFor('Digit0')).toBe('0')
  })

  it('writes the modifier prefix once, before the alternatives', () => {
    expect(chordFromCodes({ codes: ['KeyC', 'KeyX', 'KeyV'], ctrl: true })).toBe('Ctrl+C / X / V')
  })

  it('orders the modifiers Ctrl, Shift, Alt', () => {
    expect(chordFromCodes({ codes: ['KeyZ'], ctrl: true, shift: true })).toBe('Ctrl+Shift+Z')
  })

  it('collapses the two Shift keys to one token', () => {
    expect(chordFromCodes({ codes: ['ShiftLeft', 'ShiftRight'] })).toBe('Shift')
  })

  it('returns the bare modifier when there is no key to press with it', () => {
    expect(chordFromCodes({ codes: [], alt: true })).toBe('Alt')
  })
})

describe('chordFor', () => {
  it('answers for a known id and stays quiet for an unknown one', () => {
    expect(chordFor('handTool')).toBe('H')
    expect(chordFor('nothingBoundToThis')).toBeUndefined()
  })
})

/**
 * Spot-checks against the handlers themselves. These are the bindings whose
 * printed form has actually been wrong before, or which reach a view people did
 * not expect them to.
 */
describe('what the handlers actually bind', () => {
  const byId = (id: string) => SHORTCUTS.find((s) => s.id === id)

  it('keeps rotation and select-all reachable from 3D (useEditorShortcuts.ts:69,78)', () => {
    expect(byId('rotate90')?.scope).toBe('both')
    expect(byId('rotate90ccw')?.scope).toBe('both')
    expect(byId('selectAll')?.scope).toBe('both')
  })

  /**
   * This assertion used to read `'2d'`, on the stated grounds that the 3D branch
   * handled only Z/Y/D/A under Ctrl. Round 4 gave 3D a `⋯` actions menu offering
   * copy and cut, so the branch gained C/X/V and that reasoning expired — and
   * this test failing is precisely how the change was caught rather than
   * silently leaving the help sheet describing the old scope.
   */
  it('reaches the clipboard from 3D too, now that the ⋯ menu offers copy and cut', () => {
    expect(byId('clipboard')?.scope).toBe('both')
  })

  it('keeps the arrows 2D-only — FlyControls owns them in 3D (FlyControls.tsx:49-63)', () => {
    expect(byId('nudge')?.scope).toBe('2d')
    expect(byId('fly')?.codes).toContain('ArrowUp')
  })

  /**
   * The angle lives in exactly one string in the whole app. It has been printed
   * as 15° and as 5°, and once with the Shift polarity inverted; naming the two
   * dead values here means restoring either one fails the suite.
   */
  it('states the gizmo snap angle, and states the current one', () => {
    const label = resolve(byId('gizmoRotate')!.labelKey) as string
    expect(label).toContain('45°')
    expect(label).toContain('Shift')
    expect(label).not.toContain('15°')
    expect(label).not.toContain('של 5°')
  })
})
