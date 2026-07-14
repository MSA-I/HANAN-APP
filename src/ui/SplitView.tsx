/**
 * A generic two-pane horizontal split with a draggable divider.
 *
 * RTL-aware: `start` renders on the RIGHT (it will hold the 2D editor) and its
 * share is `ratio`; `end` renders on the LEFT. Because the layout is RTL, the
 * divider position measured from the container's left edge maps to the start
 * share as `1 - x/width`. Ratio is clamped to [0.3, 0.7], reset on double-click,
 * and persisted to localStorage.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'hanan.splitRatio'
const MIN = 0.3
const MAX = 0.7

const clamp = (r: number) => Math.min(MAX, Math.max(MIN, r))

export type SplitLayout = 'both' | 'start-only' | 'end-only'

export interface SplitViewProps {
  start: ReactNode
  end: ReactNode
  defaultRatio?: number
  /**
   * 'start-only' / 'end-only' hide the other pane with CSS while KEEPING it
   * mounted — critical for the 3D pane, whose WebGL context must survive
   * view-mode switches (remounting leaks/loses GL contexts).
   */
  layout?: SplitLayout
}

export function SplitView({ start, end, defaultRatio = 0.6, layout = 'both' }: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [ratio, setRatio] = useState<number>(() => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    const parsed = stored ? Number(stored) : NaN
    return Number.isFinite(parsed) ? clamp(parsed) : clamp(defaultRatio)
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(ratio))
    } catch {
      // storage may be unavailable (private mode) — ignore
    }
  }, [ratio])

  const updateFromClientX = useCallback((clientX: number) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    // start pane is on the right under RTL → its share grows as the divider moves left
    setRatio(clamp(1 - (clientX - rect.left) / rect.width))
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    updateFromClientX(e.clientX)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const startStyle =
    layout === 'both'
      ? { flex: `0 0 calc(${ratio * 100}% - 3px)` }
      : layout === 'start-only'
        ? { flex: '1 1 100%' }
        : { display: 'none' }
  const endHidden = layout === 'start-only'

  return (
    <div ref={containerRef} className="flex h-full w-full">
      <div className="min-w-0 overflow-hidden" style={startStyle}>
        {start}
      </div>
      {layout === 'both' && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => setRatio(clamp(defaultRatio))}
          className={
            'relative z-10 shrink-0 grow-0 cursor-col-resize touch-none border-x border-line transition-colors ' +
            (dragging ? 'bg-accent' : 'bg-line hover:bg-accent-tint')
          }
          style={{ flexBasis: 6 }}
        />
      )}
      <div className="min-w-0 flex-1 overflow-hidden" style={endHidden ? { display: 'none' } : undefined}>
        {end}
      </div>
    </div>
  )
}
