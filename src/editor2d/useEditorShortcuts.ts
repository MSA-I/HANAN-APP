/**
 * Global editor shortcuts. Bound to PHYSICAL keys (event.code) so they work
 * identically under the Hebrew keyboard layout.
 */
import { useEffect } from 'react'
import {
  clearSelection,
  duplicateObjects,
  mirrorCopyObjects,
  mirrorObjects,
  moveObjectsBy,
  redo,
  removeObjects,
  rotateObjectsBy,
  select,
  undo,
  updateSettings,
} from '../state/actions'
import { visibleTopLevelIds } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { copySelection, cutSelection, pasteClipboard } from './clipboard'
import { overlay, useOverlayStore } from './overlayStore'

export interface ZoomApi {
  zoomIn: () => void
  zoomOut: () => void
  zoom100: () => void
  fitVenue: () => void
  fitSelection: () => void
}

export function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Mirror Shift into `overlayStore.shiftHeld`, which both rotation gizmos read to
 * decide whether the 45° snap is engaged (the 3D one has no DOM event to ask).
 *
 * Reads `e.shiftKey` rather than testing for the Shift key itself, so pressing or
 * releasing ANY key re-answers the question and a missed event self-corrects. Runs
 * before the typing-target guard: a modifier held down is a fact about the
 * keyboard, not about which field has focus.
 *
 * Guarded against writing the same value — this runs on every keystroke, and a
 * no-op `setState` would still notify every subscriber.
 */
function trackShift(e: KeyboardEvent): void {
  if (useOverlayStore.getState().shiftHeld !== e.shiftKey) overlay.setShiftHeld(e.shiftKey)
}

export function useEditorShortcuts(zoom: ZoomApi): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      trackShift(e)
      // In full-3D mode the fly controls own the NAVIGATION keys (Stage2D is only
      // CSS-hidden, so this handler still fires) — W/A/S/D, Q/E, arrows, Shift and
      // Space belong to FlyControls and must fall through untouched. What this
      // branch owns is the editing that has to work wherever the object is
      // visible: undo/redo, duplicate, delete, select-all, rotate, help, Esc.
      //
      // Ctrl+A and R were 2D-only until PLAN-09 (items 24 and 16) purely because
      // this branch returned before reaching them, which made the same object
      // rotatable from the plan and inert in the view the user was looking at.
      // Neither collides with the fly controls: `KeyR` is not in their KEYMAP, and
      // their handler bails on ctrl/meta/alt (FlyControls.tsx:49-63 · :186).
      //
      // onKeyUp stays unconditional so spacePan can't get stuck when switching
      // modes mid-hold. 'split' keeps normal 2D behavior.
      if (useEditorStore.getState().mode === '3d') {
        if (isTypingTarget(e)) return
        const s3 = useEditorStore.getState()
        const ctrl = e.ctrlKey || e.metaKey
        if (ctrl) {
          if (e.code === 'KeyZ') {
            if (e.shiftKey) redo()
            else undo()
            e.preventDefault()
          } else if (e.code === 'KeyY') {
            redo()
            e.preventDefault()
          } else if (e.code === 'KeyD') {
            if (s3.selection.length) duplicateObjects(s3.selection)
            e.preventDefault()
          } else if (e.code === 'KeyA') {
            select(visibleTopLevelIds(s3.scene))
            e.preventDefault()
          } else if (e.code === 'KeyC') {
            // Round 4: the 3D `⋯` menu offers copy and cut, so the keys have to
            // agree with it — an action a menu offers and a key refuses is worse
            // than neither. This is why `clipboard` is scoped `'both'` in
            // `core/shortcuts.ts` rather than `'2d'`.
            copySelection()
            e.preventDefault()
          } else if (e.code === 'KeyX') {
            cutSelection()
            e.preventDefault()
          } else if (e.code === 'KeyV') {
            pasteClipboard()
            e.preventDefault()
          }
          return
        }
        if (e.code === 'Slash') {
          overlay.toggleHelp()
          e.preventDefault()
        } else if (e.code === 'KeyR') {
          // no preventDefault, matching the 2D branch below
          if (s3.selection.length) rotateObjectsBy(s3.selection, e.shiftKey ? -90 : 90)
        } else if (e.code === 'KeyM') {
          // Alt FIRST: both branches reached `KeyM` without looking at modifiers,
          // so Alt+M performed a plain mirror until this line existed.
          if (s3.selection.length) (e.altKey ? mirrorCopyObjects : mirrorObjects)(s3.selection)
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
          if (s3.selection.length) removeObjects(s3.selection)
          e.preventDefault()
        } else if (e.code === 'Escape') {
          if (useOverlayStore.getState().placing) {
            overlay.setPlacing(null)
            overlay.setGhost(null)
            return
          }
          // objects are selectable in 3D too — Esc drills out / deselects
          const drilled = s3.selection.length === 1 ? s3.scene.objects[s3.selection[0]] : null
          if (drilled?.parentId) select([drilled.parentId])
          else clearSelection()
        }
        return
      }
      if (isTypingTarget(e)) return

      const state = useEditorStore.getState()
      const sel = state.selection
      const ctrl = e.ctrlKey || e.metaKey

      if (e.code === 'Space' && !e.repeat) {
        overlay.setSpacePan(true)
        e.preventDefault()
        return
      }

      if (ctrl) {
        switch (e.code) {
          case 'KeyZ':
            if (e.shiftKey) redo()
            else undo()
            e.preventDefault()
            return
          case 'KeyY':
            redo()
            e.preventDefault()
            return
          case 'KeyD':
            if (sel.length) duplicateObjects(sel)
            e.preventDefault()
            return
          case 'KeyC':
            copySelection()
            e.preventDefault()
            return
          case 'KeyX':
            cutSelection()
            e.preventDefault()
            return
          case 'KeyV':
            pasteClipboard()
            e.preventDefault()
            return
          case 'KeyA':
            select(visibleTopLevelIds(state.scene))
            e.preventDefault()
            return
          case 'Equal':
          case 'NumpadAdd':
            zoom.zoomIn()
            e.preventDefault()
            return
          case 'Minus':
          case 'NumpadSubtract':
            zoom.zoomOut()
            e.preventDefault()
            return
          case 'Digit0':
            zoom.zoom100()
            e.preventDefault()
            return
        }
        return
      }

      switch (e.code) {
        case 'Delete':
        case 'Backspace':
          if (sel.length) removeObjects(sel)
          e.preventDefault()
          return
        case 'Escape': {
          if (useOverlayStore.getState().placing) {
            overlay.setPlacing(null)
            overlay.setGhost(null)
            return
          }
          // drilled-in chair: Esc steps back out to its parent table
          if (sel.length === 1) {
            const drilled = state.scene.objects[sel[0]]
            if (drilled?.parentId) {
              select([drilled.parentId])
              return
            }
          }
          clearSelection()
          overlay.setMarquee(null)
          return
        }
        case 'KeyV':
          overlay.setHandTool(false)
          return
        case 'KeyH':
          overlay.setHandTool(true)
          return
        case 'Slash':
          overlay.toggleHelp()
          e.preventDefault()
          return
        case 'KeyR':
          if (sel.length) rotateObjectsBy(sel, e.shiftKey ? -90 : 90)
          return
        case 'KeyM':
          if (sel.length) (e.altKey ? mirrorCopyObjects : mirrorObjects)(sel)
          return
        case 'KeyG':
          if (e.shiftKey) updateSettings({ snapEnabled: !state.scene.settings.snapEnabled })
          else updateSettings({ showGrid: !state.scene.settings.showGrid })
          return
        case 'Digit1':
          if (e.shiftKey) {
            zoom.fitVenue()
            e.preventDefault()
          }
          return
        case 'Digit2':
          if (e.shiftKey) {
            zoom.fitSelection()
            e.preventDefault()
          }
          return
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          if (!sel.length) return
          const step = e.shiftKey ? 100 : e.altKey ? 1 : 10
          const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
          const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
          moveObjectsBy(sel, { x: dx, y: dy })
          e.preventDefault()
          return
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      trackShift(e)
      if (e.code === 'Space') overlay.setSpacePan(false)
    }

    /**
     * Alt-tab away while holding Space and the keyup lands in the other window —
     * it never arrives here at all. The editor is then stuck in pan mode, wearing
     * the hand cursor, with nothing on screen saying why and no way out except
     * pressing and releasing Space again. Shift is the same story now that a held
     * Shift quantises rotation: a stuck one would make free rotation impossible
     * with no visible cause.
     *
     * `blur` is the only event that fires in that case, and it must clear BOTH.
     */
    const onBlur = () => {
      overlay.setSpacePan(false)
      overlay.setShiftHeld(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [zoom])
}
