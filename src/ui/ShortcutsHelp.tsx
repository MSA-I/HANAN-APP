import { X } from 'lucide-react'
import { useEffect } from 'react'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { strings } from './strings'

type HelpRow = readonly [string, string]

/**
 * `strings.help.rows` / `rows3d` are frozen `as const` arrays and strings.ts is a
 * pure dictionary, so PLAN-09's corrections were SEEDED beside them
 * (strings.ts:595-615) rather than written into them. Applying them is this file's
 * job, and it is done here — at the one place that renders the table — so there is
 * no second list to keep in step.
 *
 * Matched BY CONTENT, never by index: these two rotation rows have now been wrong
 * three times (15° steps → inverted Shift → the snap removed entirely), and an
 * index would happily rewrite whichever row drifted into that slot.
 *
 * `RowKeys` is the tripwire that makes the matching safe: `rows` is `as const`, so
 * typing the two labels as "one of the key columns that actually exist" turns a
 * renamed row into a BUILD failure instead of a silent no-match that quietly
 * restores the wrong help text.
 */
type RowKeys = (typeof strings.help.rows)[number][0]
const ROTATION_KEYS: RowKeys = 'סיבוב בגיזמו'
/** Gone with the 5° snap in PLAN-09/G1 — it now describes behaviour that is absent. */
const SHIFT_ROTATION_KEYS: RowKeys = 'Shift בסיבוב'

const HELP_ROWS: readonly HelpRow[] = strings.help.rows
  .filter(([keys]) => keys !== SHIFT_ROTATION_KEYS)
  .map((row) => (row[0] === ROTATION_KEYS ? strings.help.rotationFreeRow : row))

/** R and Ctrl+A reach 3D as of PLAN-09 (items 16, 24) — see useEditorShortcuts.ts. */
const HELP_ROWS_3D: readonly HelpRow[] = [...strings.help.rows3d, ...strings.help.rows3dExtra]

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
          <button
            title={strings.help.close}
            aria-label={strings.help.close}
            className="rounded-md p-2 text-ink-soft hover:bg-accent-tint hover:text-ink"
            onClick={() => overlay.setHelpOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <Rows rows={HELP_ROWS} />
        <h3 className="mt-5 mb-1.5 text-[16px] font-semibold">{strings.help.title3d}</h3>
        <Rows rows={HELP_ROWS_3D} />
      </div>
    </div>
  )
}

function Rows({ rows }: { rows: readonly HelpRow[] }) {
  return (
    <table className="w-full text-[14px]">
      <tbody>
        {rows.map(([keys, label]) => (
          <tr key={keys} className="border-b border-line/60 last:border-0">
            <td className="py-2 pe-3 text-ink-soft">{label}</td>
            <td className="ltr-nums py-2 text-end font-mono text-[13px] text-ink">{keys}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
