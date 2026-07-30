/**
 * The shortcut reference, rendered FROM `core/shortcuts.ts`.
 *
 * It used to render `strings.help.rows` — a hand-copied prose duplicate of the
 * handlers — and then patch itself at render time by string-matching the two
 * rows it distrusted, because the plans that kept finding those rows wrong were
 * not allowed to edit `strings.ts`. The rotation row alone was wrong three
 * times. The catalog is now the one source this panel and every tooltip read,
 * and `shortcuts.test.ts` checks each printed chord against the codes the
 * handler actually listens for — so there is nothing left here to correct, and
 * no filtering, patching or string matching remains.
 *
 * The four tuple tables this file used to read — `help.rows`, `rows3d`,
 * `rows3dExtra`, `rotationFreeRow` — went with it, along with the `RowKeys` tsc
 * tripwire derived from `rows` being `as const`. Nothing here references them by
 * any name.
 */
import { X } from 'lucide-react'
import { useEffect } from 'react'
import {
  chordFor,
  shortcutsFor,
  type Shortcut,
  type ShortcutGroup,
  type ShortcutScope,
} from '../core/shortcuts'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { chordIsLatin, Tooltip } from './Tooltip'
import { strings } from './strings'

/** Rendered in this order. A group with no entries in the scope is skipped. */
const GROUP_ORDER: readonly ShortcutGroup[] = ['tools', 'edit', 'view', 'nav']

const GROUP_HEADING: Readonly<Record<ShortcutGroup, string>> = {
  tools: strings.help.groupTools,
  edit: strings.help.groupEdit,
  view: strings.help.groupView,
  nav: strings.help.groupNav,
}

/**
 * `labelKey` is a dotted path because `core/` may not import `ui/` — resolving
 * it is the other half of that contract. Read the FIELD rather than rebuilding
 * `help.keys.${id}` from the id: the catalog's own test only guarantees that the
 * field resolves.
 *
 * A key that does not resolve falls back to the path itself, never to an empty
 * string. `shortcuts.test.ts` fails on a missing key, so this can only fire on a
 * catalog entry added without one — and a row reading `help.keys.foo` says which
 * key is missing, where a blank row says nothing at all.
 */
function labelFor(labelKey: string): string {
  let node: unknown = strings
  for (const segment of labelKey.split('.')) {
    if (typeof node !== 'object' || node === null) return labelKey
    node = (node as Record<string, unknown>)[segment]
  }
  return typeof node === 'string' && node.length > 0 ? node : labelKey
}

function groupsOf(scope: ShortcutScope): Array<{ group: ShortcutGroup; rows: Shortcut[] }> {
  const entries = shortcutsFor(scope)
  return GROUP_ORDER.map((group) => ({
    group,
    rows: entries.filter((s) => s.group === group),
  })).filter(({ rows }) => rows.length > 0)
}

export function ShortcutsHelp() {
  const open = useOverlayStore((s) => s.helpOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') overlay.setHelpOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-6"
      onClick={() => overlay.setHelpOpen(false)}
    >
      <div
        role="dialog"
        aria-label={strings.help.title}
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-line bg-panel p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold">{strings.help.title}</h2>
          <Tooltip label={strings.help.close} chord={chordFor('escape')}>
            <button
              title={strings.help.close}
              aria-label={strings.help.close}
              className="rounded-md p-2 text-ink-soft hover:bg-accent-tint hover:text-ink"
              onClick={() => overlay.setHelpOpen(false)}
            >
              <X size={18} />
            </button>
          </Tooltip>
        </div>
        {/* The app's own two names for its two views, from the toolbar switch.
            Every `scope: 'both'` entry appears under both headings on purpose:
            a user in 3D reading the 3D half must not have to know that half the
            gestures were listed above under a heading that said 2D. */}
        <Section scope="2d" title={strings.viewMode.d2} />
        <Section scope="3d" title={strings.viewMode.d3} />
      </div>
    </div>
  )
}

function Section({ scope, title }: { scope: Exclude<ShortcutScope, 'both'>; title: string }) {
  return (
    <>
      <h3 className="mt-5 mb-1.5 text-[16px] font-semibold">{title}</h3>
      {groupsOf(scope).map(({ group, rows }) => (
        <div key={group}>
          <h4 className="mt-4 mb-1 text-[13px] font-semibold text-ink-soft">{GROUP_HEADING[group]}</h4>
          <table className="w-full text-[14px]">
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 pe-3 text-ink-soft">{labelFor(entry.labelKey)}</td>
                  {/* PER ROW, never on the column. `.ltr-nums` is
                      `direction: ltr; unicode-bidi: isolate` plus the mono
                      family, which is right for `Ctrl+Z` and MANGLES the third
                      of the catalog whose chords are Hebrew prose
                      (`לחצן ימני + גרירה`, `גרירה מהספרייה`); the mixed
                      `Shift + קליק שמאלי` is the worst case, where an
                      LTR-forced run reorders the Hebrew against the Latin
                      token. `chordIsLatin` is the predicate `Tooltip` already
                      uses on the same cell. */}
                  <td
                    className={`py-2 text-end text-[13px] text-ink${
                      chordIsLatin(entry.chord) ? ' ltr-nums' : ''
                    }`}
                  >
                    {entry.chord}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
