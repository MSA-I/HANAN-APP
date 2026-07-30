import { Maximize, Minus, Plus, TriangleAlert } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { Violation } from '../core/layout/collision'
import { chordFor } from '../core/shortcuts'
import { getVenuePack } from '../core/venuePacks'
import { useSaveStatus } from '../persistence/autosave'
import { sceneCounts } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { useOverlayStore } from '../editor2d/overlayStore'
import { useViewportStore, ZOOM_100 } from '../editor2d/viewportStore'
import { zoomApi } from '../editor2d/zoomBus'
import { Tooltip } from './Tooltip'
import { strings } from './strings'

const S = strings.statusBar
const V = strings.status.violation

/** The pack's own Hebrew zone label, falling back to the raw kind. */
function zoneLabel(venuePackId: string | null | undefined, kind: string): string {
  return getVenuePack(venuePackId)?.restricted?.find((z) => z.kind === kind)?.label ?? kind
}

/**
 * A catalog id as the user's own name for it. Guarded with `hasCatalogEntry`
 * because `getCatalogEntry` THROWS: a violation can name an id a stale project
 * still refers to, and a status message is the last place that should take the
 * app down. The id itself is the fallback — ugly on purpose, so it reads as
 * something to fix rather than as a label.
 */
function itemLabel(catalogId: string): string {
  if (!hasCatalogEntry(catalogId)) return catalogId
  const key = getCatalogEntry(catalogId).labelKey as keyof typeof strings.catalog.items
  return strings.catalog.items[key] ?? catalogId
}

function violationText(violation: Violation, venuePackId: string | null | undefined): string {
  switch (violation.kind) {
    case 'collision':
      return V.collision
    case 'spacing':
      return V.spacing
        .replace('{actual}', String(Math.round(violation.actual)))
        .replace('{required}', String(violation.required))
    case 'outOfBounds':
      return V.outOfBounds
    case 'forbiddenZone':
      return V.forbiddenZone.replace('{zone}', zoneLabel(venuePackId, violation.zone))
    case 'wrongZone':
      return V.wrongZone.replace(
        '{zone}',
        violation.allowed.map((kind) => zoneLabel(venuePackId, kind)).join(' / '),
      )
    case 'nearWall':
      return V.nearWall.replace('{within}', String(violation.within))
    case 'missingHost':
      return V.missingHost(itemLabel(violation.requires))
    case 'overlapsSibling':
      return V.overlapsSibling
    case 'duplicate':
      return V.duplicate
  }
}

function ViolationNotice() {
  const violation = useOverlayStore((s) => s.violation)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  if (!violation) return null
  return (
    <span
      role="status"
      className="flex items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning"
    >
      <TriangleAlert size={13} />
      {violationText(violation, venuePackId)}
    </span>
  )
}

type ZoomButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'title'> & {
  title: string
}

function ZoomButton({ title, children, ...rest }: ZoomButtonProps) {
  return (
    <button
      // ⚠ Derived attributes FIRST, `...rest` last — the same ordering
      // `Toolbar`'s `IconButton` needs and for the same reason. `Tooltip` clones
      // its child with `title: undefined`, `aria-label` and `aria-describedby`;
      // if the derived `aria-label={title}` were written after the spread it
      // would resolve to undefined and wipe out the real name, leaving an
      // icon-only button with none at all.
      title={title}
      aria-label={title}
      {...rest}
      className="rounded p-1.5 text-ink-soft transition-colors hover:bg-accent-tint hover:text-ink"
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
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-line bg-chrome px-3 text-[13px] text-ink-soft">
      {/* start (right in RTL): cursor coordinates + zoom controls */}
      <div className="flex items-center gap-3">
        <span className="ltr-nums inline-block w-24 text-start">{cursorText}</span>
        {/* `placement="top"` on every one of them: this bar is the bottom 36px
            of the window, and a tooltip below its trigger computes an offset
            past the viewport and gets clamped back on top of the button it is
            describing. The chords come from `core/shortcuts.ts`, never from a
            literal here. */}
        <div className="flex items-center gap-0.5">
          <Tooltip label={S.zoomOut} chord={chordFor('zoomOut')} placement="top">
            <ZoomButton title={S.zoomOut} onClick={() => zoomApi()?.zoomOut()}>
              <Minus size={15} />
            </ZoomButton>
          </Tooltip>
          {/* the only one with visible text — and "100%" is a READOUT, not a
              name: nothing on it says that pressing it resets the zoom */}
          <Tooltip label={strings.menu.zoom100} chord={chordFor('zoom100')} placement="top">
            <button
              title={strings.menu.zoom100}
              aria-label={strings.menu.zoom100}
              onClick={() => zoomApi()?.zoom100()}
              className="ltr-nums min-h-7 w-12 rounded py-1 text-center font-mono text-[13px] text-ink hover:bg-accent-tint"
            >
              {pct}%
            </button>
          </Tooltip>
          <Tooltip label={S.zoomIn} chord={chordFor('zoomIn')} placement="top">
            <ZoomButton title={S.zoomIn} onClick={() => zoomApi()?.zoomIn()}>
              <Plus size={15} />
            </ZoomButton>
          </Tooltip>
          <Tooltip label={S.zoomFit} chord={chordFor('fitVenue')} placement="top">
            <ZoomButton title={S.zoomFit} onClick={() => zoomApi()?.fitVenue()}>
              <Maximize size={15} />
            </ZoomButton>
          </Tooltip>
        </div>
      </div>

      {/* end (left in RTL): why the last action was refused, counts, save status */}
      <div className="flex items-center gap-3">
        <ViolationNotice />
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

// The one-slot `Notice` used to render here. It moved to `ui/NoticeStack.tsx`,
// mounted from `App` — a message with an undo button in it cannot live in a
// 36px bar that already carries six things, and it must not be overwritten by
// the next mouse move. `ViolationNotice` stays: it is positional feedback about
// the thing under the cursor, not a transient event.

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
