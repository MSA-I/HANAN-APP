/**
 * Design-edit mode chrome (source doc §11 + §52): the chip that names the table
 * being arranged and the way out, plus the Esc handler that closes the mode.
 *
 * VIEW-AGNOSTIC ON PURPOSE, and mounted exactly once — from `App.tsx`, ABOVE the
 * split rather than inside either pane. The mode belongs to both views (plan G3),
 * and `SplitView` hides the unused pane with `display:none`: mounting this in
 * `Stage2D` would leave a user in full 3D with no chip and no exit button.
 *
 * ⚠ Esc is registered on `window` in the CAPTURE phase and stops propagation.
 * `useEditorShortcuts` listens on the same window in the BUBBLE phase and would
 * otherwise clear the selection — or drill out of a chair — on the very
 * keystroke that closes the mode; in 3D it takes a different branch but still
 * handles Esc. Capture at the root runs before every listener further down the
 * path, so stopping there is what keeps one Esc doing exactly one thing.
 */
import { X } from 'lucide-react'
import { useEffect } from 'react'
import type { Id } from '../core/model/types'
import { displayName } from '../editor2d/ObjectNode'
import { useOverlayStore } from '../editor2d/overlayStore'
import { isTypingTarget } from '../editor2d/useEditorShortcuts'
import { select } from '../state/actions'
import { designEditTable } from '../state/selectors'
import { setDesignEditTable, useEditorStore } from '../state/store'
import { strings } from './strings'

const S = strings.editMode

/**
 * Close the session and put the user back on the table they opened. Leaving a
 * drilled-in decor child selected would keep it draggable and keep the inspector
 * on it, with no mode left to explain why.
 */
export function exitDesignEdit(): void {
  const { scene, designEditTableId } = useEditorStore.getState()
  const tableId = designEditTable(scene, designEditTableId)
  setDesignEditTable(null)
  if (tableId) select([tableId])
}

export function DesignEditMode() {
  const tableId = useEditorStore((s) => designEditTable(s.scene, s.designEditTableId))
  const tableName = useEditorStore((s) => {
    const id = designEditTable(s.scene, s.designEditTableId)
    const table = id ? s.scene.objects[id] : null
    return table ? displayName(table.name, table.catalogId, table.meta.number) : null
  })

  // Dev-only handle, same precedent as `window.__stage` (Stage2D): a headless
  // verification run can open and close the mode without having to synthesise a
  // double-click on a Konva node at the right stage coordinates.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __designEdit?: unknown }
    w.__designEdit = { enter: (id: Id) => setDesignEditTable(id), exit: exitDesignEdit }
    return () => {
      delete w.__designEdit
    }
  }, [])

  useEffect(() => {
    if (!tableId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Escape' || isTypingTarget(e)) return
      // An armed placement ghost owns Esc first, exactly as it does globally:
      // the user is cancelling the item on the cursor, not the mode behind it.
      if (useOverlayStore.getState().placing) return
      e.stopPropagation()
      e.preventDefault()
      exitDesignEdit()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [tableId])

  if (!tableId) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-accent bg-panel px-3 py-1.5 text-[13px] shadow-sm">
        <span className="font-semibold text-accent">{S.title}</span>
        <span>{tableName}</span>
        <span className="text-ink-soft">·</span>
        <span className="text-ink-soft">{S.hint}</span>
        <button
          type="button"
          title={S.exit}
          aria-label={S.exit}
          data-testid="design-edit-exit"
          onClick={exitDesignEdit}
          className="rounded-full p-0.5 text-ink-soft transition-colors hover:bg-accent-tint hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
