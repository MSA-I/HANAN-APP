/**
 * The corner strip that tells you what your hands can do RIGHT NOW, and the
 * first-run card that teaches the mouse.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. It printed a single frozen line — the whole
 * flight key list — in every state the viewer could be in. A line that never
 * changes is wallpaper within a minute, and it was silent about the two things
 * users actually got stuck on: that a selected table is turned by the ring round
 * it, and that releasing a drag is what commits it.
 *
 * ⚠ THE NAVIGATION SCHEME IS NOT CHANGING. The user was shown that Planner 5D,
 * Home Designer and Chief Architect all default to left-drag-orbit and
 * deliberately chose to keep Lumion's right-drag look and fix DISCOVERY instead.
 * So nothing here rebinds anything; it only says out loud what the buttons
 * already do.
 *
 * The card auto-collapses to the one-liner once dismissed OR once the user has
 * demonstrably flown — competence should dismiss a tutorial, not only a button.
 */
import { useEffect, useState } from 'react'
import { HelpCircle, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { viewerHint, type HintId } from '../core/viewerHints'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { designEditTable } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { isRotating, onRotatingChange } from './RotateHandle'
import { strings3d } from './strings3d'

const HINT_TEXT: Record<HintId, string> = {
  idle: strings3d.hint.idle,
  selection: strings3d.hint.selection,
  dragMove: strings3d.hint.dragMove,
  dragRotate: strings3d.hint.dragRotate,
  orbit: strings3d.hint.orbit,
  placing: strings3d.hint.placing,
  designEdit: strings3d.hint.designEdit,
}

/** Same persistence shape as `SplitView.tsx:41-47` — a bare key, failures ignored. */
const SEEN_KEY = 'hanan.nav3d.seen'

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {
    // private mode — the card simply shows again next session
  }
}

/**
 * Has the user shown they can already fly? First movement key or first
 * right-drag. Deliberately NOT persisted separately: it collapses the card for
 * this session, and `writeSeen` records it so the next session opens collapsed
 * too. Someone who has flown does not need to be told how.
 */
function useFlownYet(active: boolean): boolean {
  const [flown, setFlown] = useState(false)
  useEffect(() => {
    if (!active || flown) return
    const MOVEMENT = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ])
    const done = () => {
      setFlown(true)
      writeSeen()
    }
    const onKey = (e: KeyboardEvent) => {
      if (MOVEMENT.has(e.code)) done()
    }
    const onPointer = (e: PointerEvent) => {
      if (e.button === 2) done()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [active, flown])
  return flown
}

/**
 * A three-button mouse, as a few paths. In-scene geometry was never an option
 * for this (the empty hall is already ~2,700 draw calls), and an <img> would be
 * a network request inside a component whose entire job is to appear instantly.
 *
 * `currentColor` throughout, so it inherits the chip's text colour and needs no
 * second styling decision.
 */
function MouseGlyph() {
  return (
    <svg viewBox="0 0 32 48" width="34" height="51" aria-hidden className="shrink-0">
      <rect x="1" y="1" width="30" height="46" rx="15" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {/* the split across the top third — where the three buttons end */}
      <path d="M1 18 H31" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <path d="M11 1.6 V18 M21 1.6 V18" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      {/* the right button, filled: the one this app is built on */}
      <path d="M21 2 H16 A15 15 0 0 1 31 17 V18 H21 Z" fill="currentColor" opacity="0.85" />
      {/* the wheel */}
      <rect x="14" y="6" width="4" height="8" rx="2" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

function NavCard({ onDismiss }: { onDismiss: (forever: boolean) => void }) {
  const N = strings3d.navCard
  return (
    <div className="w-72 rounded-xl border border-line bg-panel/92 p-3 text-[13px] text-ink-soft shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-ink">{N.title}</span>
        <button
          type="button"
          onClick={() => onDismiss(false)}
          aria-label={N.gotIt}
          className="rounded-full p-1 text-ink-soft hover:bg-accent-tint hover:text-accent"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex items-start gap-3">
        <MouseGlyph />
        <ul className="flex-1 space-y-0.5">
          <li className="font-semibold text-ink">{N.rightButton}</li>
          <li>{N.middleButton}</li>
          <li>{N.wheel}</li>
          <li>{N.leftButton}</li>
        </ul>
      </div>
      <p className="mt-2 border-t border-line pt-2 leading-relaxed">{N.keys}</p>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => onDismiss(false)}
          className="min-h-8 flex-1 rounded-full border border-line px-3 text-[13px] font-semibold text-ink hover:border-accent hover:text-accent"
        >
          {N.gotIt}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(true)}
          className="min-h-8 flex-1 rounded-full px-3 text-[13px] text-ink-soft hover:text-accent"
        >
          {N.never}
        </button>
      </div>
    </div>
  )
}

export function FlyHint() {
  const is3d = useEditorStore((s) => s.mode === '3d')
  const [dismissed, setDismissed] = useState(readSeen)
  const flown = useFlownYet(is3d && !dismissed)

  /**
   * The rotation flag is a module-level notifier rather than store state — a
   * rotation drag must not write to the editor store on every frame — so it is
   * mirrored into React here, twice per gesture.
   */
  const [rotating, setRotating] = useState(isRotating)
  useEffect(() => onRotatingChange(setRotating), [])

  // useShallow: the selector builds a fresh object, and a snapshot whose identity
  // changes on every render loops forever under zustand v5
  const ctx = useEditorStore(
    useShallow((s) => ({
      selection: s.selection.length,
      designEdit: designEditTable(s.scene, s.designEditTableId) !== null,
    })),
  )
  const placing = useOverlayStore((s) => !!s.placing)

  if (!is3d) return null

  /**
   * `orbitHeld` and the MOVE half of `dragging` are deliberately not threaded in.
   * Both live in refs inside `FlyControls`/`ObjectGroup` precisely so they cost
   * no re-render, and surfacing them would mean a `setState` per gesture in the
   * hottest paths in the viewer. `viewerHint`'s precedence is total, so passing
   * the two states we DO know cheaply yields the right line for every case that
   * can actually be observed here; the two omitted ones fall through to
   * `selection`, which is what the pointer is over anyway.
   */
  const hint = viewerHint({
    selection: ctx.selection,
    placing,
    orbitHeld: false,
    dragging: rotating ? 'rotate' : null,
    designEdit: ctx.designEdit,
  })

  const dismiss = (forever: boolean) => {
    setDismissed(true)
    if (forever) writeSeen()
  }

  const showCard = !dismissed && !flown

  return (
    <div className="absolute bottom-3 z-10 flex flex-col gap-2" style={{ insetInlineStart: '0.75rem' }}>
      {showCard && <NavCard onDismiss={dismiss} />}
      <div className="flex items-center gap-1 self-start rounded-full border border-line bg-panel/90 px-3 py-1.5 text-[13px] text-ink-soft shadow-sm backdrop-blur">
        <span>{HINT_TEXT[hint]}</span>
        {/* `/` already opens the help, but a keyboard-only route to discoverability
            is circular — you have to know the key to learn the keys. */}
        <button
          type="button"
          onClick={() => overlay.toggleHelp()}
          title={strings3d.hint.help}
          aria-label={strings3d.hint.help}
          className="-me-1 flex items-center rounded-full p-0.5 text-ink-soft hover:text-accent"
        >
          <HelpCircle size={14} />
        </button>
      </div>
    </div>
  )
}
