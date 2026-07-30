/**
 * The app's modal dialog — promoted, not invented.
 *
 * This is `Dashboard`'s `ModalShell` moved out verbatim: same backdrop, same
 * panel, same `role="dialog"` / `aria-modal` / `aria-labelledby`, same
 * Escape-to-close and backdrop-mousedown-to-close with `stopPropagation` on the
 * panel. The capability was never missing — it was unused, while the editor
 * still called `window.confirm`. Two real gaps are closed here: focus is
 * TRAPPED inside the panel and RESTORED to whatever had it when the dialog
 * opened.
 *
 * NOT the native `<dialog>` / `showModal()`. That would change focus, backdrop,
 * top-layer and Escape semantics app-wide, and `Dashboard` is the one screen
 * whose modals already work — there is nothing to win and a working screen to
 * lose.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

/**
 * Put this on the control that should own focus when the dialog opens. Without
 * it the first focusable element gets it, which is the right default for a form
 * and the wrong one for anything destructive.
 */
export const INITIAL_FOCUS_ATTR = 'data-dialog-initial-focus'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(panel: HTMLElement): HTMLElement[] {
  // `getClientRects()` rather than `offsetParent`: a positioned control reports
  // a null offsetParent and would silently drop out of the tab ring.
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  )
}

export interface DialogProps {
  /** Escape, the backdrop and the close button all route here. */
  onClose: () => void
  /** id of the element holding the dialog's title. */
  labelledBy: string
  /** id of the element holding its explanatory body, when there is one. */
  describedBy?: string
  children: ReactNode
}

export function Dialog({ onClose, labelledBy, describedBy, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    // Whatever opened the dialog gets focus back when it closes — usually the
    // button that opened it, which is where the user's attention already is.
    const opener = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const initial = panel?.querySelector<HTMLElement>(`[${INITIAL_FOCUS_ATTR}]`)
    const target = initial ?? (panel ? focusableIn(panel)[0] : null)
    target?.focus()

    return () => {
      // `isConnected` because the opener can be gone — deleting a project
      // unmounts the card whose kebab menu raised the confirm.
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // Tab must not walk out of a modal and into the page behind it, which is
  // still fully focusable — `aria-modal` tells a screen reader to ignore that
  // page but does nothing whatsoever to the tab ring.
  const onKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const items = focusableIn(panel)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  )
}

export interface ConfirmDialogProps {
  title: string
  /** The explanatory line. Omit it when the title is the whole question. */
  body?: ReactNode
  /** Names the thing it is about to do — never a bare "אישור". */
  confirmLabel: string
  cancelLabel: string
  /** Destructive: the confirm goes red and Cancel takes focus. */
  danger?: boolean
  /** Defaults to `cancel` when `danger`, `confirm` otherwise. */
  initialFocus?: 'cancel' | 'confirm'
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Title + body + cancel/confirm. This is `Dashboard`'s `DeleteConfirmModal`
 * generalised — the danger styling and the "Cancel is focused first" rule are
 * lifted from it unchanged, because on a destructive dialog the safe answer is
 * the one that should be one Enter away.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
  initialFocus,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const titleId = useId()
  const bodyId = useId()
  const focused = initialFocus ?? (danger ? 'cancel' : 'confirm')

  return (
    <Dialog onClose={onCancel} labelledBy={titleId} describedBy={body ? bodyId : undefined}>
      <h2 id={titleId} className="mb-2 text-[18px] font-semibold text-ink">
        {title}
      </h2>
      {body && (
        <p id={bodyId} className="text-[14px] text-ink-soft">
          {body}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          {...(focused === 'cancel' ? { [INITIAL_FOCUS_ATTR]: '' } : {})}
          type="button"
          onClick={onCancel}
          className="min-h-10 rounded-md px-4 py-2 text-[14px] font-medium text-ink-soft hover:bg-canvas"
        >
          {cancelLabel}
        </button>
        <button
          {...(focused === 'confirm' ? { [INITIAL_FOCUS_ATTR]: '' } : {})}
          type="button"
          onClick={onConfirm}
          className={`min-h-10 rounded-md px-4 py-2 text-[14px] font-medium text-white ${
            danger ? 'bg-danger hover:brightness-95' : 'bg-accent hover:bg-accent-hover'
          }`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}
