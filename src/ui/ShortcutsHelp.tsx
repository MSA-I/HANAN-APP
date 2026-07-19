import { X } from 'lucide-react'
import { useEffect } from 'react'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { strings } from './strings'

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
        className="max-h-full w-96 overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">{strings.help.title}</h2>
          <button
            title={strings.help.close}
            aria-label={strings.help.close}
            className="rounded-md p-1 text-ink-soft hover:bg-accent-tint hover:text-ink"
            onClick={() => overlay.setHelpOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        <Rows rows={strings.help.rows} />
        <h3 className="mt-4 mb-1 text-[13px] font-semibold">{strings.help.title3d}</h3>
        <Rows rows={strings.help.rows3d} />
      </div>
    </div>
  )
}

function Rows({ rows }: { rows: ReadonlyArray<readonly [string, string]> }) {
  return (
    <table className="w-full text-[12px]">
      <tbody>
        {rows.map(([keys, label]) => (
          <tr key={keys} className="border-b border-line/60 last:border-0">
            <td className="py-1.5 pe-3 text-ink-soft">{label}</td>
            <td className="ltr-nums py-1.5 text-end font-mono text-[11px] text-ink">{keys}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
