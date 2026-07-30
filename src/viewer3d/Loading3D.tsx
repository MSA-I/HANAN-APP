/**
 * The card that stands in for the 3D view while it loads — measured at ~15 s on
 * a cold open, against a blank white pane that said nothing.
 *
 * THE WAIT IS TWO PHASES AND ONLY ONE OF THEM IS WHAT EVERYONE ASSUMES.
 *
 *  A. The `React.lazy` chunk. The built `Scene3D` chunk is 1,157 kB (321 kB
 *     gzipped) and it is the BULK of the wait. drei's `useProgress` cannot see
 *     it at all — `useProgress` only counts three.js loaders, and none have been
 *     constructed yet because the module holding them has not arrived. This is
 *     why `loadPhase` takes `moduleReady` as a separate input rather than trying
 *     to infer a phase from the progress number.
 *  B. The assets — `venue.glb` alone is 5,380,184 bytes.
 *
 * ⚠ THE BAR MUST NOT GO BACKWARDS, and `useProgress().progress` RESETS TO 0
 * every time a new loader registers, so a venue pack that pulls its props in two
 * batches drives it 0→60, 0→100. `loadPhase` fixes that only if the previous
 * percent is fed back in — which is what `prevRef` below is for. Drop that and
 * the monotonic guarantee silently disappears while every test still passes.
 *
 * EXPORTED BUT NOT WIRED. `app/App.tsx` owns the `Suspense` boundary and belongs
 * to another plan this wave; see `handoff/D3-viewer3d.md` for the two-line
 * wiring. Note that `VenueMesh.tsx:98` already suspends to a procedural room, so
 * once the Canvas itself mounts the user is looking at a room, not at white —
 * this card covers the window BEFORE that.
 */
import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { loadPhase, type LoadPhaseResult } from '../core/loadPhase'
import { strings } from '../ui/strings'

/**
 * Drives `loadPhase` from drei's loader manager.
 *
 * ⚠ MUST BE RENDERED INSIDE THE CANVAS. `useProgress` subscribes to
 * `THREE.DefaultLoadingManager`, which is a module singleton, so it technically
 * reads from anywhere — but a component outside the Canvas re-renders on every
 * loader event without R3F's batching, and the point of a hook is that the
 * caller does not have to know that. `Loading3D` itself takes the result as a
 * prop and stays a pure DOM component.
 */
export function useLoadProgress(moduleReady: boolean): LoadPhaseResult {
  const { active, progress, total } = useProgress()
  const startedRef = useRef(performance.now())
  const prevRef = useRef(0)
  const [, force] = useState(0)

  // `slow` flips on a clock, not on an event — without a timer the card would
  // sit at "loading" forever and only apologise if some loader happened to fire
  useEffect(() => {
    const timer = window.setTimeout(() => force((n) => n + 1), 6000)
    return () => window.clearTimeout(timer)
  }, [])

  const result = loadPhase({
    moduleReady,
    active,
    progress,
    total,
    elapsedMs: performance.now() - startedRef.current,
    prevPercent: prevRef.current,
  })
  prevRef.current = result.percent
  return result
}

/**
 * Reuses the `Fallback` card markup at `Scene3D.tsx:68-77` verbatim —
 * `rounded-xl border border-line bg-panel p-6` on `bg-canvas` — so the WebGL
 * failure card and the loading card are visibly the same object in two states,
 * rather than two designers' guesses at a centred box.
 */
export function Loading3D({ phase, percent, slow }: LoadPhaseResult) {
  const W = strings.workspace
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas p-6">
      <div className="max-w-sm rounded-xl border border-line bg-panel p-6 text-center shadow-sm">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">
          {phase === 'module' ? W.loading3dModule : W.loading3dAssets}
        </h2>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="ltr-nums mt-2 text-[13px] text-ink-soft">{W.loading3dPercent(Math.round(percent))}</p>
        {slow && <p className="mt-1 text-[13px] text-ink-soft">{W.loading3dSlow}</p>}
      </div>
    </div>
  )
}
