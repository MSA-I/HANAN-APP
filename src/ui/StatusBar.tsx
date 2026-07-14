import { Maximize, Minus, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useSaveStatus } from '../persistence/autosave'
import { sceneCounts } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useOverlayStore } from '../editor2d/overlayStore'
import { useViewportStore, ZOOM_100 } from '../editor2d/viewportStore'
import { zoomApi } from '../editor2d/zoomBus'
import { strings } from './strings'

const S = strings.statusBar

function ZoomButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="rounded p-1 text-ink-soft transition-colors hover:bg-accent-tint hover:text-ink"
    >
      {children}
    </button>
  )
}

export function StatusBar() {
  const cursor = useOverlayStore((s) => s.cursorWorld)
  const zoom = useViewportStore((s) => s.zoom)
  const counts = useEditorStore(useShallow((s) => sceneCounts(s.scene)))

  const pct = Math.round((zoom / ZOOM_100) * 100)
  const cursorText = cursor ? `${(cursor.x / 100).toFixed(2)}, ${(cursor.y / 100).toFixed(2)}` : '—'

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-chrome px-3 text-[11px] text-ink-soft">
      {/* start (right in RTL): cursor coordinates + zoom controls */}
      <div className="flex items-center gap-3">
        <span className="ltr-nums inline-block w-24 text-start">{cursorText}</span>
        <div className="flex items-center gap-0.5">
          <ZoomButton title={S.zoomOut} onClick={() => zoomApi()?.zoomOut()}>
            <Minus size={13} />
          </ZoomButton>
          <button
            title={strings.menu.zoom100}
            aria-label={strings.menu.zoom100}
            onClick={() => zoomApi()?.zoom100()}
            className="ltr-nums w-11 rounded py-0.5 text-center font-mono text-[11px] text-ink hover:bg-accent-tint"
          >
            {pct}%
          </button>
          <ZoomButton title={S.zoomIn} onClick={() => zoomApi()?.zoomIn()}>
            <Plus size={13} />
          </ZoomButton>
          <ZoomButton title={S.zoomFit} onClick={() => zoomApi()?.fitVenue()}>
            <Maximize size={13} />
          </ZoomButton>
        </div>
      </div>

      {/* end (left in RTL): live scene counts + save status */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="ltr-nums">{counts.tables}</span> {S.tables}
          <span className="text-line">·</span>
          <span className="ltr-nums">{counts.chairs}</span> {S.chairs}
          <span className="text-line">·</span>
          <span className="ltr-nums">{counts.seats}</span> {S.seats}
        </div>
        <SaveIndicator />
      </div>
    </footer>
  )
}

function SaveIndicator() {
  const { status } = useSaveStatus()
  if (status === 'idle') return null
  if (status === 'error') {
    return (
      <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
        {strings.status.saveFailed}
      </span>
    )
  }
  return (
    <span className={status === 'saving' ? 'text-ink-soft' : 'text-success'}>
      {status === 'saving' ? strings.status.saving : strings.status.saved}
    </span>
  )
}
