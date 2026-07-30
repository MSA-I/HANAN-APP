/**
 * The 3D view's own editing surface for the thing that is selected.
 *
 * THE PROBLEM IT SOLVES. Every table setting — seat count, chair gap, chair
 * model, place settings, table design, cloth colour, hang height — lived only in
 * the 2D-side inspector, 900 px away from the table the user is looking at. In
 * full-3D mode that panel is not even on screen. There was no 3D-native way to
 * configure anything; the view was a viewer.
 *
 * THE DECISIVE CALL: THE POPOVERS HOST THE EXISTING INSPECTOR SECTIONS VERBATIM.
 * `SeatingSection`, `PlaceSettingsSection`, `HangingSection` and
 * `TableDesignSection` are rendered unchanged, and that is not laziness:
 *
 *  1. `SeatingSection` derives its seat cap from `maxSeatsForEntry` and its gap
 *     cap from `maxGapForSeats`, and `maxGapForSeats` exists BECAUSE a free field
 *     once silently deleted four chairs (capacity is a step function of gap with
 *     very narrow steps — the 160 square seats 12 at gap 8 and 8 at gap 9). A
 *     second seat control is a second place that can get that cap wrong, and
 *     2D/3D divergence is this repo's most-repeated bug.
 *  2. "Zero restyling" then holds by construction: same `Section`, `Stepper`,
 *     `ColorField`, `ThumbGrid`, because it is literally the same component.
 *
 * WHAT IS GENUINELY NEW IS THE BAR. The one control reached for constantly — the
 * seat count — is promoted onto the bar itself, bounded by `seatBounds` (the same
 * two numbers `SeatingSection` computes, exported from `state/selectors.ts`
 * precisely so the two cannot drift).
 *
 * REJECTED, for the record: a HUD anchored over the table (it occludes the very
 * thing being edited, and swims while you fly — and flying is this app's whole
 * navigation model), and a second floating panel (that is the inspector, moved).
 *
 * The bar is a fixed screen-space strip, so it cannot say WHICH of forty tables
 * it is acting on; `TableLabel3D` pins that to the table itself.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronUp, CopyPlus, MoreHorizontal, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getCatalogEntry, hasCatalogEntry } from '../core/catalog/registry'
import type { SceneObject } from '../core/model/types'
import { ROTATION_SNAP_DEG } from '../core/rotation'
import { copySelection, cutSelection } from '../editor2d/clipboard'
import { displayName } from '../editor2d/ObjectNode'
import { useOverlayStore } from '../editor2d/overlayStore'
import {
  duplicateObjects,
  removeObjects,
  reorder,
  mirrorObjects,
  rotateObjectsBy,
  setLocked,
  setSeatCount,
} from '../state/actions'
import {
  isEffectivelyLocked,
  menuCapabilities,
  seatBounds,
  selectedTable,
} from '../state/selectors'
import { useEditorStore } from '../state/store'
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu'
import {
  HangingSection,
  PlaceSettingsSection,
  SeatingSection,
} from '../ui/InspectorPanel'
import { TableDesignSection } from '../ui/PresetsSection'
import { strings } from '../ui/strings'
import { strings3d } from './strings3d'

/** Which popover is open — at most one, ever. */
type PopoverId = 'chairs' | 'design' | 'height'

const BUTTON =
  'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35'
const ICON_BUTTON =
  'flex items-center justify-center rounded-full p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-35'
const DIVIDER = 'mx-0.5 h-4 w-px bg-line'

function Divider() {
  return <span className={DIVIDER} aria-hidden />
}

/**
 * The panel that hangs above a trigger. Scrollable and height-capped because
 * `TableDesignSection` is a thumbnail grid and would otherwise run off the top of
 * a laptop screen — the bar sits at the BOTTOM, so a popover grows upward into a
 * viewport whose height it cannot assume.
 */
function Popover({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current
      if (!el || el.contains(e.target as Node)) return
      // the trigger runs its own toggle on click; closing here too would reopen it
      if ((e.target as Element | null)?.closest?.('[data-popover-trigger]')) return
      onClose()
    }
    /**
     * CAPTURE, and `stopPropagation`. Escape in the 3D view also clears the
     * selection (`useEditorShortcuts`) and hard-releases every held movement key
     * (`FlyControls.tsx:169`). Without the capture phase the popover and the
     * selection would both go on one press, so closing a panel would throw away
     * the table it was editing.
     */
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 mb-2 max-h-[min(60vh,26rem)] w-72 -translate-x-1/2 overflow-y-auto rounded-xl border border-line bg-panel/92 p-3 shadow-lg backdrop-blur"
    >
      {children}
    </div>
  )
}

/**
 * Subscribes to the whole object and hands it to the hosted inspector section.
 *
 * ⚠ THIS SUBSCRIPTION IS WHY IT IS A SEPARATE COMPONENT. The sections take a
 * `SceneObject` as a plain prop and read `obj.seating.count` straight off it —
 * inside the inspector their parent re-renders and they come along. Here, the
 * BAR must not subscribe to the object: Immer gives it a new identity on every
 * transient transform write, so a bar that held one would re-render through every
 * frame of a rotation drag, which is exactly the cost `ObjectGroup`'s transient
 * architecture exists to avoid. Confining the subscription to the mounted
 * popover means it is only ever live while the user is in a panel — and nobody
 * is dragging a table while a panel is open.
 */
function PopoverSection({ id, children }: { id: string; children: (obj: SceneObject) => ReactNode }) {
  const obj = useEditorStore((s) => s.scene.objects[id])
  if (!obj) return null
  return <>{children(obj)}</>
}

/**
 * The seat count, on the bar rather than two clicks into a popover — it is the
 * control the user reaches for constantly.
 *
 * Bounded by `seatBounds`, NOT by the catalog cap alone: `setSeatCount` clamps
 * only to `entry.seating.min/max` and knows nothing about whether the chairs
 * physically fit at the current gap. The geometric ceiling is the UI's job, and
 * `seatBounds` is the same pair of numbers `SeatingSection` shows, so the stepper
 * here and the stepper in the popover stop at the same place.
 */
function SeatStepper({ tableId }: { tableId: string }) {
  const state = useEditorStore(
    useShallow((s) => {
      const obj = s.scene.objects[tableId]
      const bounds = seatBounds(s.scene, tableId)
      return {
        count: obj?.seating?.count ?? 0,
        min: bounds?.min ?? 0,
        max: bounds?.max ?? 0,
        locked: !!obj && isEffectivelyLocked(s.scene, obj),
      }
    }),
  )
  if (!state.max) return null

  return (
    <span className="flex items-center gap-0.5" title={strings3d.bar.seats}>
      <button
        type="button"
        className={`${ICON_BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        disabled={state.locked || state.count <= state.min}
        aria-label={strings3d.bar.seatsRemove}
        title={strings3d.bar.seatsRemove}
        onClick={() => setSeatCount(tableId, state.count - 1)}
      >
        <span aria-hidden>−</span>
      </button>
      <span className="ltr-nums min-w-6 text-center text-[13px] font-semibold text-ink" aria-live="polite">
        {state.count}
      </span>
      <button
        type="button"
        className={`${ICON_BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        disabled={state.locked || state.count >= state.max}
        aria-label={strings3d.bar.seatsAdd}
        title={strings3d.bar.seatsAdd}
        onClick={() => setSeatCount(tableId, state.count + 1)}
      >
        <span aria-hidden>+</span>
      </button>
    </span>
  )
}

/**
 * The rotation cluster: two 45° steps around a live readout.
 *
 * ⚠ THE READOUT IS WRITTEN IMPERATIVELY, from a `useEditorStore.subscribe`, in
 * exactly the way `ObjectGroup.tsx` writes the group matrix. A selector here
 * would re-render this component on every frame of a rotation drag, and the bar
 * is a React subtree containing four popover triggers — the whole point of the
 * transient-transform architecture is that a drag costs zero React renders.
 *
 * And it reads the COMMITTED rotation out of the store, never the pointer angle:
 * `setRotation` runs `poseAllowed` and can REFUSE (a turned table that would
 * clip its neighbours), so a readout that followed the pointer would confidently
 * display an angle the table is not at.
 */
function RotationCluster({ id, canRotate }: { id: string; canRotate: boolean }) {
  const readoutRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const write = (deg: number | undefined) => {
      const el = readoutRef.current
      if (el) el.textContent = strings3d.bar.rotationValue(Math.round(deg ?? 0))
    }
    write(useEditorStore.getState().scene.objects[id]?.transform.rotation)
    return useEditorStore.subscribe((s) => s.scene.objects[id]?.transform.rotation, write)
  }, [id])

  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        className={`${ICON_BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        disabled={!canRotate}
        aria-label={strings3d.bar.rotateCcw}
        title={strings3d.bar.rotateCcw}
        onClick={() => rotateObjectsBy([id], -ROTATION_SNAP_DEG)}
      >
        <RotateCcw size={14} />
      </button>
      <span ref={readoutRef} className="ltr-nums min-w-10 text-center text-[13px] text-ink-soft" aria-live="off" />
      <button
        type="button"
        className={`${ICON_BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        disabled={!canRotate}
        aria-label={strings3d.bar.rotateCw}
        title={strings3d.bar.rotateCw}
        onClick={() => rotateObjectsBy([id], ROTATION_SNAP_DEG)}
      >
        <RotateCw size={14} />
      </button>
    </span>
  )
}

/**
 * Everything the 2D right-click offers, reached from a VISIBLE control.
 *
 * The right button is not available: it is free-look, and this app's navigation
 * is built on it. `Ctrl`+right would be undiscoverable, and a menu on
 * right-button RELEASE would race the `DBL_RMB_MS = 350` teleport window at
 * `FlyControls.tsx:259-267`. So the affordance is a `⋯` you can see.
 *
 * Built from `menuCapabilities`, so it cannot offer a different set of things
 * than the plan's menu — and so a disabled entry is greyed rather than shown and
 * silently dropped inside the action, which is the failure round 3 was
 * criticised for.
 */
function OverflowMenu({ onClose, anchor }: { onClose: () => void; anchor: DOMRect }) {
  const caps = useEditorStore((s) => menuCapabilities(s.scene, s.selection, s.selection[0] ?? null))
  const ids = caps.ids
  const M = strings.menu

  const items: MenuEntry[] = [
    { label: M.duplicate, shortcut: 'Ctrl+D', disabled: !caps.canDuplicate, onClick: () => duplicateObjects(ids) },
    { label: M.copy, shortcut: 'Ctrl+C', disabled: !caps.canCopy, onClick: () => copySelection() },
    { label: M.cut, shortcut: 'Ctrl+X', disabled: !caps.canCut, onClick: () => cutSelection() },
    'separator',
    { label: M.rotate90, shortcut: 'R', disabled: !caps.canRotate, onClick: () => rotateObjectsBy(ids, 90) },
    {
      label: M.rotate90ccw,
      shortcut: 'Shift+R',
      disabled: !caps.canRotate,
      onClick: () => rotateObjectsBy(ids, -90),
    },
    // Same gate as rotation: both are poses, and both are refused for the same
    // reasons (locked, frozen, or no legal room in the new pose).
    { label: M.mirror, shortcut: 'M', disabled: !caps.canRotate, onClick: () => mirrorObjects(ids) },
    'separator',
    { label: M.bringToFront, disabled: !caps.canReorder, onClick: () => ids.forEach((id) => reorder(id, 'front')) },
    { label: M.sendToBack, disabled: !caps.canReorder, onClick: () => ids.forEach((id) => reorder(id, 'back')) },
    'separator',
    {
      label: caps.anyLocked ? M.unlock : M.lock,
      disabled: !caps.canLock,
      onClick: () => setLocked(ids, !caps.anyLocked),
    },
    {
      label: M.delete,
      shortcut: 'Del',
      danger: true,
      disabled: !caps.canDelete,
      onClick: () => removeObjects(ids),
    },
  ]

  // opens ABOVE the bar — ContextMenu clamps into the viewport itself, and the
  // bar is 12 px off the bottom edge, so a menu positioned at the trigger would
  // be shoved back over the button that opened it
  return <ContextMenu x={anchor.right} y={anchor.top - 8} items={items} onClose={onClose} />
}

export function SelectionBar3D() {
  const placing = useOverlayStore((s) => s.placing)
  const [popover, setPopover] = useState<PopoverId | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)

  const state = useEditorStore(
    useShallow((s) => {
      const objects = s.selection.map((id) => s.scene.objects[id]).filter(Boolean)
      const only = s.selection.length === 1 ? s.scene.objects[s.selection[0]] : undefined
      return {
        count: s.selection.length,
        // the selection identity, so a popover closes when the user picks another table
        key: s.selection.join(','),
        singleId: only?.id ?? null,
        name: only ? displayName(only.name, only.catalogId, only.meta.number) : '',
        tableId: selectedTable(s.scene, s.selection),
        isCeiling:
          !!only && hasCatalogEntry(only.catalogId) && getCatalogEntry(only.catalogId).placement === 'ceiling',
        canRotate: !!only && !isEffectivelyLocked(s.scene, only),
        canDelete: objects.some((obj) => !isEffectivelyLocked(s.scene, obj)),
        canDuplicate:
          objects.length === s.selection.length &&
          objects.length > 0 &&
          objects.every((obj) => !obj.parentId && !isEffectivelyLocked(s.scene, obj)),
      }
    }),
  )

  // A popover edits ONE object. Changing the selection out from under it would
  // leave a seat stepper pointed at a table nobody is looking at any more.
  useEffect(() => {
    setPopover(null)
    setMenuAnchor(null)
  }, [state.key])

  /**
   * `Shift+F10` and the dedicated ContextMenu key — the OS-standard keyboard
   * route to a context menu, and the ONLY route a keyboard-only user has here,
   * since the right button is free-look and stays that way.
   *
   * Bound in this component rather than routed through
   * `editor2d/useEditorShortcuts.ts` (another plan's file this wave) because it
   * has to reach `moreRef` to position the menu, and because a binding that
   * lives beside the thing it opens cannot fall out of step with it.
   * `isTypingTarget` is not needed: neither chord produces text, and F10 inside
   * the seat field should still open the menu for the table being edited.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.code === 'F10' && e.shiftKey) || e.code === 'ContextMenu')) return
      e.preventDefault()
      setMenuAnchor((current) => (current ? null : (moreRef.current?.getBoundingClientRect() ?? null)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!state.count || placing) return null

  const toggle = (id: PopoverId) => setPopover((current) => (current === id ? null : id))
  const trigger = (id: PopoverId, label: string, title: string) => (
    <button
      type="button"
      data-popover-trigger
      aria-expanded={popover === id}
      title={title}
      onClick={() => toggle(id)}
      className={
        `${BUTTON} ` +
        (popover === id ? 'bg-accent text-white' : 'text-ink-soft hover:bg-accent-tint hover:text-accent')
      }
    >
      <span>{label}</span>
      <ChevronUp size={13} aria-hidden />
    </button>
  )

  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      {popover === 'chairs' && state.tableId && (
        <Popover onClose={() => setPopover(null)}>
          <PopoverSection id={state.tableId}>{(obj) => <SeatingSection obj={obj} />}</PopoverSection>
        </Popover>
      )}
      {popover === 'design' && state.tableId && (
        <Popover onClose={() => setPopover(null)}>
          <PopoverSection id={state.tableId}>
            {(obj) => (
              <>
                <TableDesignSection obj={obj} />
                <PlaceSettingsSection obj={obj} />
              </>
            )}
          </PopoverSection>
        </Popover>
      )}
      {popover === 'height' && state.singleId && state.isCeiling && (
        <Popover onClose={() => setPopover(null)}>
          <PopoverSection id={state.singleId}>{(obj) => <HangingSection obj={obj} />}</PopoverSection>
        </Popover>
      )}

      <div className="flex items-center gap-1 rounded-full border border-line bg-panel/92 p-1 shadow-lg backdrop-blur">
        <span className="px-2 text-[13px] font-semibold text-ink-soft" aria-live="polite">
          {state.count === 1
            ? state.name || strings3d.selection.one
            : strings3d.selection.many(state.count)}
        </span>

        {state.tableId && (
          <>
            <Divider />
            <SeatStepper tableId={state.tableId} />
            <Divider />
            {trigger('chairs', strings3d.bar.chairs, strings3d.bar.chairsTitle)}
            {trigger('design', strings3d.bar.design, strings3d.bar.designTitle)}
          </>
        )}

        {/* the one control 3D had no route to at all until now */}
        {state.isCeiling && (
          <>
            <Divider />
            {trigger('height', strings3d.bar.height, strings3d.bar.heightTitle)}
          </>
        )}

        {state.singleId && (
          <>
            <Divider />
            <RotationCluster id={state.singleId} canRotate={state.canRotate} />
          </>
        )}

        <Divider />
        <button
          type="button"
          disabled={!state.canDuplicate}
          onClick={() => duplicateObjects(useEditorStore.getState().selection)}
          title={strings3d.selection.duplicate}
          aria-label={strings3d.selection.duplicate}
          className={`${BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        >
          <CopyPlus size={14} />
          <span>{strings3d.selection.duplicateShort}</span>
        </button>
        <button
          type="button"
          disabled={!state.canDelete}
          onClick={() => removeObjects(useEditorStore.getState().selection)}
          title={strings3d.selection.delete}
          aria-label={strings3d.selection.delete}
          className={`${BUTTON} text-danger hover:bg-danger/10`}
        >
          <Trash2 size={14} />
          <span>{strings3d.selection.deleteShort}</span>
        </button>

        <Divider />
        <button
          ref={moreRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={!!menuAnchor}
          title={strings3d.selection.more}
          aria-label={strings3d.selection.more}
          onClick={() =>
            setMenuAnchor((current) =>
              current ? null : (moreRef.current?.getBoundingClientRect() ?? null),
            )
          }
          className={`${ICON_BUTTON} text-ink-soft hover:bg-accent-tint hover:text-accent`}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {menuAnchor && <OverflowMenu anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />}
    </div>
  )
}
