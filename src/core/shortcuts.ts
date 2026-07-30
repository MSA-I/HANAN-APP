/**
 * The single catalog of every gesture the editor binds.
 *
 * WHY THIS FILE EXISTS. Until now the help table was a hand-copied prose
 * duplicate of the switch statement in `editor2d/useEditorShortcuts.ts`, with no
 * mechanical relationship to it. It has been wrong three times about one row
 * alone (15° steps → the Shift polarity inverted → a 5° snap that no longer
 * exists), and `ui/ShortcutsHelp.tsx` currently patches itself at render time by
 * string-matching the rows it distrusts. A prose duplicate cannot be checked, so
 * it drifts; this one can, and `shortcuts.test.ts` does the checking:
 *
 *   - every printed `chord` must be REDERIVABLE from `codes` + the modifier
 *     flags via `chordFromCodes` — change the binding without changing the
 *     printed text and the suite fails
 *   - no two entries visible in the same view may print the same chord
 *   - every `labelKey` must resolve to a non-empty string in `ui/strings.ts`
 *
 * WHAT IS AND IS NOT IN HERE. `codes` are PHYSICAL `KeyboardEvent.code` values,
 * which is what the handlers actually compare against so the Hebrew layout
 * behaves identically. Pointer gestures carry `codes: []` and spell their chord
 * out in Hebrew — there is no physical key to derive it from, so the derivation
 * test skips them by construction. A modifier that only VARIES an existing
 * gesture (Shift on the arrows, Shift on the gizmo ring) stays inside that
 * entry's label rather than becoming a row of its own, which is how the help
 * table has always read it.
 *
 * NO IMPORTS ON PURPOSE. `core/` must not depend on `ui/`, so `labelKey` is a
 * dotted path rather than the string itself; the test resolves it, and the
 * renderer resolves it at runtime.
 */

export type ShortcutScope = '2d' | '3d' | 'both'
export type ShortcutGroup = 'tools' | 'edit' | 'view' | 'nav'

export interface Shortcut {
  /** stable, unique; also the last segment of `labelKey` */
  id: string
  /** which view the binding is live in — `'both'` shows up in each */
  scope: ShortcutScope
  group: ShortcutGroup
  /** physical `KeyboardEvent.code` values; empty for a pointer gesture */
  codes: string[]
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  /** what is PRINTED. For a keyboard entry this must equal `chordFromCodes(…)`. */
  chord: string
  /** dotted path into `ui/strings.ts`, e.g. `'help.keys.undoRedo'` */
  labelKey: string
}

/**
 * Codes whose printed name is not simply the code with its prefix removed.
 * `ShiftLeft`/`ShiftRight` collapse to one token — `chordFromCodes` dedupes, so
 * an entry bound to both prints `Shift` once.
 */
const CODE_TOKENS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Numpad+',
  NumpadSubtract: 'Numpad-',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
}

/** The key label for one physical code — `KeyV` → `V`, `Digit0` → `0`. */
export function tokenFor(code: string): string {
  const mapped = CODE_TOKENS[code]
  if (mapped !== undefined) return mapped
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

/**
 * The printed chord a binding is ENTITLED to, derived from what it listens for.
 *
 * The modifier prefix is written once and the alternative keys follow it, which
 * is the house style the help table already used for `Ctrl+C / X / V` — three
 * separate Ctrl chords on one line.
 */
export function chordFromCodes(s: Pick<Shortcut, 'codes' | 'ctrl' | 'shift' | 'alt'>): string {
  const mods: string[] = []
  if (s.ctrl) mods.push('Ctrl')
  if (s.shift) mods.push('Shift')
  if (s.alt) mods.push('Alt')
  const body = [...new Set(s.codes.map(tokenFor))].join(' / ')
  const prefix = mods.join('+')
  if (!body) return prefix
  return prefix ? `${prefix}+${body}` : body
}

export const SHORTCUTS: readonly Shortcut[] = [
  // ---- tools ------------------------------------------------------------
  {
    id: 'selectTool',
    scope: '2d',
    group: 'tools',
    codes: ['KeyV'],
    chord: 'V',
    labelKey: 'help.keys.selectTool',
  },
  {
    id: 'handTool',
    scope: '2d',
    group: 'tools',
    codes: ['KeyH'],
    chord: 'H',
    labelKey: 'help.keys.handTool',
  },
  /**
   * Holding Alt as a placement is committed leaves the item armed for the next
   * click instead of disarming the tool — `Stage2D.tsx:469` in 2D and
   * `Placement3D.tsx:174` · `ObjectGroup.tsx:362` in 3D, which is why it is
   * `'both'`. Never documented anywhere until now.
   */
  {
    id: 'placeRepeat',
    scope: 'both',
    group: 'tools',
    codes: [],
    chord: 'Alt בהצבה',
    labelKey: 'help.keys.placeRepeat',
  },

  // ---- edit -------------------------------------------------------------
  {
    id: 'undoRedo',
    scope: 'both',
    group: 'edit',
    codes: ['KeyZ', 'KeyY'],
    ctrl: true,
    chord: 'Ctrl+Z / Y',
    labelKey: 'help.keys.undoRedo',
  },
  /** the second redo binding (`useEditorShortcuts.ts:60` · `:112`) — a real key, not a row the help has to show */
  {
    id: 'redoAlt',
    scope: 'both',
    group: 'edit',
    codes: ['KeyZ'],
    ctrl: true,
    shift: true,
    chord: 'Ctrl+Shift+Z',
    labelKey: 'help.keys.redoAlt',
  },
  {
    id: 'duplicate',
    scope: 'both',
    group: 'edit',
    codes: ['KeyD'],
    ctrl: true,
    chord: 'Ctrl+D',
    labelKey: 'help.keys.duplicate',
  },
  /** the 3D branch handles only Z/Y/D/A under Ctrl, so the clipboard is 2D-only */
  {
    id: 'clipboard',
    scope: '2d',
    group: 'edit',
    codes: ['KeyC', 'KeyX', 'KeyV'],
    ctrl: true,
    chord: 'Ctrl+C / X / V',
    labelKey: 'help.keys.clipboard',
  },
  {
    id: 'deleteSelection',
    scope: 'both',
    group: 'edit',
    codes: ['Delete', 'Backspace'],
    chord: 'Delete / Backspace',
    labelKey: 'help.keys.deleteSelection',
  },
  {
    id: 'selectAll',
    scope: 'both',
    group: 'edit',
    codes: ['KeyA'],
    ctrl: true,
    chord: 'Ctrl+A',
    labelKey: 'help.keys.selectAll',
  },
  {
    id: 'rotate90',
    scope: 'both',
    group: 'edit',
    codes: ['KeyR'],
    chord: 'R',
    labelKey: 'help.keys.rotate90',
  },
  {
    id: 'rotate90ccw',
    scope: 'both',
    group: 'edit',
    codes: ['KeyR'],
    shift: true,
    chord: 'Shift+R',
    labelKey: 'help.keys.rotate90ccw',
  },
  /**
   * The 3D branch returns before it reaches the arrows, and they belong to
   * FlyControls' KEYMAP there — so nudging is 2D-only. Shift and Alt only
   * resize the step (`useEditorShortcuts.ts:216`), so they stay in the label
   * rather than becoming rows.
   */
  {
    id: 'nudge',
    scope: '2d',
    group: 'edit',
    codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
    chord: '↑ / ↓ / ← / →',
    labelKey: 'help.keys.nudge',
  },
  {
    id: 'escape',
    scope: 'both',
    group: 'edit',
    codes: ['Escape'],
    chord: 'Esc',
    labelKey: 'help.keys.escape',
  },
  {
    id: 'selectItem',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'קליק שמאלי',
    labelKey: 'help.keys.selectItem',
  },
  /**
   * `dragController.onObjectMouseDown/onObjectClick:26,37` in 2D and
   * `ObjectGroup.tsx:366` in 3D. The help listed it under 3D only, which is
   * where it is least surprising and least needed.
   */
  {
    id: 'addToSelection',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'Shift + קליק שמאלי',
    labelKey: 'help.keys.addToSelection',
  },
  {
    id: 'dragItem',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'גרירת קליק שמאלי',
    labelKey: 'help.keys.dragItem',
  },
  /** `dragController.ts:96` (2D) and `ObjectGroup.tsx:440` (3D) — the same rule twice */
  {
    id: 'snapBypass',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'Alt בזמן גרירה',
    labelKey: 'help.keys.snapBypass',
  },
  /**
   * NEW this round. 2D only: Konva owns the object drag, and the 3D drag is a
   * different code path that is not gaining the gesture in the same wave.
   */
  {
    id: 'dragDuplicate',
    scope: '2d',
    group: 'edit',
    codes: [],
    chord: 'Ctrl בגרירה',
    labelKey: 'help.keys.dragDuplicate',
  },
  /**
   * Konva's `shiftBehavior` is left at `'default'`, which is
   * `keepRatio() || e.shiftKey` (`konva/lib/shapes/Transformer.js:523`) — Shift
   * ADDS the constraint, it never releases it. The `linkWidthDepth` tables
   * already keep their ratio, so there Shift is simply a no-op.
   */
  {
    id: 'keepRatio',
    scope: '2d',
    group: 'edit',
    codes: [],
    chord: 'Shift בשינוי גודל',
    labelKey: 'help.keys.keepRatio',
  },
  /** `centeredScaling() || e.altKey` — same file, `:525` · `:632` */
  {
    id: 'resizeFromCenter',
    scope: '2d',
    group: 'edit',
    codes: [],
    chord: 'Alt בשינוי גודל',
    labelKey: 'help.keys.resizeFromCenter',
  },
  /**
   * The ring turns freely at every angle in both views
   * (`SelectionTransformer.tsx:80-86` · `ObjectGroup.tsx:224-227`); Shift
   * regains a snap this round, at 45°. This is the row that has been wrong
   * three times — the label is the only place the angle is written down.
   */
  {
    id: 'gizmoRotate',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'סיבוב בגיזמו',
    labelKey: 'help.keys.gizmoRotate',
  },
  { id: 'contextMenu', scope: '2d', group: 'edit', codes: [], chord: 'לחצן ימני', labelKey: 'help.keys.contextMenu' },
  /**
   * `dragController.onObjectDblClick` / `onChildDblClick` and their 3D twin
   * `designEditTargetOf` (`ObjectGroup.tsx:169-194`) — deliberately the same
   * gesture in both views, and absent from the help in both.
   */
  {
    id: 'designEdit',
    scope: 'both',
    group: 'edit',
    codes: [],
    chord: 'דאבל־קליק על שולחן',
    labelKey: 'help.keys.designEdit',
  },
  {
    id: 'drillChair',
    scope: '2d',
    group: 'edit',
    codes: [],
    chord: 'דאבל־קליק על כיסא',
    labelKey: 'help.keys.drillChair',
  },

  // ---- view -------------------------------------------------------------
  { id: 'toggleGrid', scope: '2d', group: 'view', codes: ['KeyG'], chord: 'G', labelKey: 'help.keys.toggleGrid' },
  {
    id: 'toggleSnap',
    scope: '2d',
    group: 'view',
    codes: ['KeyG'],
    shift: true,
    chord: 'Shift+G',
    labelKey: 'help.keys.toggleSnap',
  },
  {
    id: 'zoomIn',
    scope: '2d',
    group: 'view',
    codes: ['Equal', 'NumpadAdd'],
    ctrl: true,
    chord: 'Ctrl+= / Numpad+',
    labelKey: 'help.keys.zoomIn',
  },
  {
    id: 'zoomOut',
    scope: '2d',
    group: 'view',
    codes: ['Minus', 'NumpadSubtract'],
    ctrl: true,
    chord: 'Ctrl+- / Numpad-',
    labelKey: 'help.keys.zoomOut',
  },
  {
    id: 'zoom100',
    scope: '2d',
    group: 'view',
    codes: ['Digit0'],
    ctrl: true,
    chord: 'Ctrl+0',
    labelKey: 'help.keys.zoom100',
  },
  {
    id: 'fitVenue',
    scope: '2d',
    group: 'view',
    codes: ['Digit1'],
    shift: true,
    chord: 'Shift+1',
    labelKey: 'help.keys.fitVenue',
  },
  {
    id: 'fitSelection',
    scope: '2d',
    group: 'view',
    codes: ['Digit2'],
    shift: true,
    chord: 'Shift+2',
    labelKey: 'help.keys.fitSelection',
  },
  { id: 'wheelZoom', scope: '2d', group: 'view', codes: [], chord: 'גלגלת עכבר', labelKey: 'help.keys.wheelZoom' },
  /**
   * ⚠ Printed as `/`, not `?`. The handler fires on the physical `Slash` key and
   * never inspects Shift (`useEditorShortcuts.ts:75` · `:188`), so `?` — which
   * is Shift+/ on a US layout and not on the key at all under Hebrew — was
   * describing a modifier the binding does not require. Both still work.
   */
  { id: 'help', scope: 'both', group: 'view', codes: ['Slash'], chord: '/', labelKey: 'help.keys.help' },

  // ---- nav --------------------------------------------------------------
  { id: 'spacePan', scope: '2d', group: 'nav', codes: ['Space'], chord: 'Space', labelKey: 'help.keys.spacePan' },
  /** `Stage2D.tsx:399` — the 2D middle-drag has never appeared in the help */
  {
    id: 'midDragPan',
    scope: '2d',
    group: 'nav',
    codes: [],
    chord: 'לחצן אמצעי + גרירה',
    labelKey: 'help.keys.midDragPan',
  },
  {
    id: 'fly',
    scope: '3d',
    group: 'nav',
    codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'],
    chord: 'W / A / S / D / ↑ / ← / ↓ / →',
    labelKey: 'help.keys.fly',
  },
  {
    id: 'flyVertical',
    scope: '3d',
    group: 'nav',
    codes: ['KeyQ', 'KeyE'],
    chord: 'Q / E',
    labelKey: 'help.keys.flyVertical',
  },
  /**
   * `shift` is deliberately UNSET on this one: Shift is the key being held, not
   * a modifier on some other key, and setting the flag as well would derive
   * `Shift+Shift`. Both physical Shifts are in `codes`; `chordFromCodes`
   * dedupes them to one token.
   */
  {
    id: 'flyFast',
    scope: '3d',
    group: 'nav',
    codes: ['ShiftLeft', 'ShiftRight'],
    chord: 'Shift',
    labelKey: 'help.keys.flyFast',
  },
  { id: 'flySlow', scope: '3d', group: 'nav', codes: ['Space'], chord: 'Space', labelKey: 'help.keys.flySlow' },
  {
    id: 'flyVeryFast',
    scope: '3d',
    group: 'nav',
    codes: ['Space'],
    shift: true,
    chord: 'Shift+Space',
    labelKey: 'help.keys.flyVeryFast',
  },
  { id: 'look', scope: '3d', group: 'nav', codes: [], chord: 'לחצן ימני + גרירה', labelKey: 'help.keys.look' },
  {
    id: 'panView3d',
    scope: '3d',
    group: 'nav',
    codes: [],
    chord: 'לחצן אמצעי + גרירה',
    labelKey: 'help.keys.panView3d',
  },
  { id: 'wheelFly', scope: '3d', group: 'nav', codes: [], chord: 'גלגלת', labelKey: 'help.keys.wheelFly' },
  /**
   * `codes: []` even though `KeyO` is real (`FlyControls.tsx:167`): O alone does
   * nothing, it only re-aims a right-drag that is already running, so the chord
   * has to name the mouse button and cannot be derived from the key.
   */
  { id: 'orbit', scope: '3d', group: 'nav', codes: [], chord: 'O + לחצן ימני', labelKey: 'help.keys.orbit' },
  {
    id: 'resetPitch',
    scope: '3d',
    group: 'nav',
    codes: ['KeyH'],
    ctrl: true,
    chord: 'Ctrl+H',
    labelKey: 'help.keys.resetPitch',
  },
  { id: 'teleport', scope: '3d', group: 'nav', codes: [], chord: 'דאבל־קליק ימני', labelKey: 'help.keys.teleport' },
]

/**
 * Everything live in one view: its own entries plus every `'both'` entry.
 * Passing `'both'` returns the whole catalog, which is what a caller that wants
 * "all of it" would reasonably expect.
 */
export function shortcutsFor(scope: ShortcutScope): Shortcut[] {
  if (scope === 'both') return [...SHORTCUTS]
  return SHORTCUTS.filter((s) => s.scope === scope || s.scope === 'both')
}

/** The printed chord for one id — for a tooltip that wants "כלי יד (H)". */
export function chordFor(id: string): string | undefined {
  return SHORTCUTS.find((s) => s.id === id)?.chord
}
