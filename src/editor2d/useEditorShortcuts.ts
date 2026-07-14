/**
 * Global editor shortcuts. Bound to PHYSICAL keys (event.code) so they work
 * identically under the Hebrew keyboard layout.
 */
import { useEffect } from 'react'
import {
  clearSelection,
  duplicateObjects,
  moveObjectsBy,
  redo,
  removeObjects,
  rotateObjectsBy,
  select,
  undo,
  updateSettings,
} from '../state/actions'
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

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useEditorShortcuts(zoom: ZoomApi): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') overlay.setShiftHeld(true)
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
            select([...state.scene.objectOrder])
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
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') overlay.setShiftHeld(false)
      if (e.code === 'Space') overlay.setSpacePan(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [zoom])
}
