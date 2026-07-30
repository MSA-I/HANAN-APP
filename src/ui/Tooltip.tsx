/**
 * A hover/focus tooltip for the icon-only chrome.
 *
 * The toolbar is unlabelled icons and native `title=` is its entire naming
 * scheme: ~1000ms before it appears, never shown on keyboard focus in Chromium,
 * unstyleable, and it flattens the `label · shortcut` pairs six of them already
 * try to encode. This does those four things properly and one more that `title`
 * cannot do at all — see the group timer below.
 *
 * NO COLLISION DETECTION, ON PURPOSE. This app is desktop-only and every
 * trigger lives in fixed chrome of known position (a 60px header, a 36px
 * footer, two fixed side panels), so the call site DECLARES its placement and
 * the tooltip is measured once at show time instead of every frame. All that is
 * left is a clamp so it cannot run off an edge — and in RTL both edges matter.
 *
 * The surface is `ContextMenu`'s surface and the chord cell is `ContextMenu`'s
 * chord cell. The right-click menu already renders label+shortcut pairs in this
 * exact idiom; a tooltip is that pair on a hover surface, so nothing new is
 * invented here.
 */
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type TooltipPlacement = 'top' | 'bottom' | 'inline-start' | 'inline-end'

/** First tooltip of a group waits this long. */
const OPEN_DELAY_MS = 400

/**
 * …but a tooltip shown this recently leaves the group WARM, and the next
 * trigger opens instantly. This is the single thing that makes a row of icons
 * learnable — you sweep the toolbar once and read all of it — and it is exactly
 * what a per-element `title` delay can never do.
 */
const WARM_MS = 300

/** Gap between the trigger and the tooltip, and from the viewport edge. */
const GAP = 6
const EDGE = 8

/** Shared across every instance: that is what makes it a GROUP timer. */
let lastHiddenAt = 0

/**
 * `.ltr-nums` is `direction: ltr; unicode-bidi: isolate` (index.css) and it
 * MANGLES Hebrew — reported by wave 1, and about a third of this app's chords
 * are Hebrew prose (`לחצן ימני + גרירה`, `Shift + קליק שמאלי`). Mixed chords are
 * the worst case: an LTR-forced run reorders the Hebrew against the Latin
 * token. So the class goes on only when there is no Hebrew to mangle.
 */
const HEBREW = /[֐-׿]/
export function chordIsLatin(chord: string): boolean {
  return !HEBREW.test(chord)
}

interface Point {
  left: number
  top: number
}

function place(anchor: DOMRect, tip: DOMRect, placement: TooltipPlacement, rtl: boolean): Point {
  const centreX = anchor.left + (anchor.width - tip.width) / 2
  const centreY = anchor.top + (anchor.height - tip.height) / 2
  // inline-start is the RIGHT edge under RTL. This is the one place the
  // physical side has to be named, because `left`/`top` on a fixed element are
  // coordinates, not styling — `ContextMenu` positions itself the same way.
  const startIsRight = rtl

  let point: Point
  switch (placement) {
    case 'top':
      point = { left: centreX, top: anchor.top - tip.height - GAP }
      break
    case 'bottom':
      point = { left: centreX, top: anchor.bottom + GAP }
      break
    case 'inline-start':
      point = startIsRight
        ? { left: anchor.right + GAP, top: centreY }
        : { left: anchor.left - tip.width - GAP, top: centreY }
      break
    case 'inline-end':
      point = startIsRight
        ? { left: anchor.left - tip.width - GAP, top: centreY }
        : { left: anchor.right + GAP, top: centreY }
      break
  }

  // Clamped on BOTH axes. The cross axis is what the brief needs — a tooltip on
  // the first or last toolbar button would otherwise clip — and the main axis
  // is clamped too because overlapping its trigger is still readable, whereas
  // sitting at a negative offset is simply invisible.
  const maxLeft = Math.max(EDGE, window.innerWidth - tip.width - EDGE)
  const maxTop = Math.max(EDGE, window.innerHeight - tip.height - EDGE)
  return {
    left: Math.min(Math.max(point.left, EDGE), maxLeft),
    top: Math.min(Math.max(point.top, EDGE), maxTop),
  }
}

export interface TooltipProps {
  /** What the control is. Becomes its accessible name. */
  label: string
  /** The shortcut chord, printed exactly as `core/shortcuts.ts` gives it. */
  chord?: string
  /** Declared, not computed — see the header. Defaults to `bottom`. */
  placement?: TooltipPlacement
  /** Skip the tooltip entirely, e.g. while a control is mid-drag. */
  disabled?: boolean
  children: ReactNode
}

export function Tooltip({
  label,
  chord,
  placement = 'bottom',
  disabled = false,
  children,
}: TooltipProps) {
  const id = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const openRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState<Point | null>(null)

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current)
    // Only a tooltip that was actually SHOWN leaves the group warm. Brushing
    // past a trigger must not buy the next one an instant open.
    if (openRef.current) lastHiddenAt = Date.now()
    openRef.current = false
    setOpen(false)
    setPoint(null)
  }, [])

  const show = useCallback(() => {
    if (disabled) return
    window.clearTimeout(timerRef.current)
    const openNow = () => {
      openRef.current = true
      setOpen(true)
    }
    if (Date.now() - lastHiddenAt < WARM_MS) openNow()
    else timerRef.current = window.setTimeout(openNow, OPEN_DELAY_MS)
  }, [disabled])

  useEffect(() => hide, [hide])
  useEffect(() => {
    if (disabled) hide()
  }, [disabled, hide])

  useEffect(() => {
    if (!open) return
    // Capture phase: only `InspectorPanel`'s <aside> scrolls, and a scroll
    // event on it does not bubble to window without this.
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, hide])

  // Two-pass: the tooltip renders hidden at its natural size, then this
  // measures it and puts it where it belongs. `whitespace-nowrap` is what makes
  // that sound — the measured width cannot change once it moves.
  useLayoutEffect(() => {
    if (!open) return
    const anchor = wrapRef.current?.getBoundingClientRect()
    const tip = tipRef.current?.getBoundingClientRect()
    if (!anchor || !tip) return
    const rtl = getComputedStyle(wrapRef.current!).direction === 'rtl'
    setPoint(place(anchor, tip, placement, rtl))
  }, [open, placement, label, chord])

  const describedBy = open && chord ? id : undefined
  const trigger = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        // Drop the native tooltip so the user never gets both. `aria-label` is
        // set here too because these triggers are icon-only: without it the
        // control would have no accessible name while the tooltip is closed.
        title: undefined,
        'aria-label': label,
        'aria-describedby': describedBy,
      })
    : children

  return (
    <>
      <span
        ref={wrapRef}
        className="inline-flex"
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocusCapture={show}
        onBlurCapture={hide}
      >
        {trigger}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[60] flex items-center gap-3 whitespace-nowrap rounded-lg border border-line bg-panel px-3 py-1.5 text-[14px] text-ink shadow-lg"
            style={{
              left: point?.left ?? 0,
              top: point?.top ?? 0,
              visibility: point ? 'visible' : 'hidden',
            }}
          >
            {/* hidden from the a11y tree when there is a chord: the trigger is
                already named `label`, so announcing it again as its description
                would read the name twice. The chord is the only new fact. */}
            <span aria-hidden={chord ? true : undefined}>{label}</span>
            {chord && (
              <span className={`text-[13px] text-ink-soft${chordIsLatin(chord) ? ' ltr-nums' : ''}`}>
                {chord}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
