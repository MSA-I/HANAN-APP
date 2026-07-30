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
 * ⚠ THIS MODULE MUST NOT IMPORT drei, three OR R3F, and that is load-bearing.
 * `app/App.tsx` renders it as the `Suspense` fallback, and `App.tsx` lives in the
 * MAIN bundle. A static import of `@react-three/drei` here would hoist drei into
 * that bundle, so the 1,157 kB chunk this card exists to apologise for would be
 * downloaded eagerly on every visit — the card would cause the wait it reports.
 * An earlier draft exported a `useLoadProgress` built on drei's `useProgress`;
 * it is gone for this reason, and it had no honest call site anyway:
 *
 * `useProgress` can only see phase B, and phase B is already covered. Once the
 * Canvas mounts, `VenueMesh.tsx:98` suspends to a PROCEDURAL ROOM, so the user is
 * looking at a room rather than at a card while the real GLB streams in. This
 * card covers only the window BEFORE the Canvas exists — which is exactly the
 * window in which no three.js loader has been constructed yet and there is
 * therefore nothing to measure. `loadPhase` is honest about that: with
 * `moduleReady: false` it holds the bar rather than inventing motion.
 */
import { useEffect, useRef, useState } from 'react'
import { loadPhase, type LoadPhaseResult } from '../core/loadPhase'
import { strings } from '../ui/strings'

/**
 * The module-download phase, driven by a clock because there is nothing else to
 * drive it: a `React.lazy` chunk is an opaque download with no progress events.
 * The bar therefore does not move — it is the heading and the "this is taking a
 * while" line that carry the information, and a bar that invented motion would
 * be lying about a number nobody reported.
 */
export function useModuleLoadPhase(): LoadPhaseResult {
  const startedRef = useRef(performance.now())
  const [, force] = useState(0)

  // `slow` flips on a clock, not on an event — without this the card would sit
  // at "loading" forever and never apologise
  useEffect(() => {
    const timer = window.setTimeout(() => force((n) => n + 1), 6000)
    return () => window.clearTimeout(timer)
  }, [])

  return loadPhase({
    moduleReady: false,
    active: true,
    progress: 0,
    total: 0,
    elapsedMs: performance.now() - startedRef.current,
    prevPercent: 0,
  })
}

/**
 * Reuses the `Fallback` card markup at `Scene3D.tsx:68-77` verbatim —
 * `rounded-xl border border-line bg-panel p-6` on `bg-canvas` — so the WebGL
 * failure card and the loading card are visibly the same object in two states,
 * rather than two designers' guesses at a centred box.
 */
export function Loading3D({ phase, percent, slow }: LoadPhaseResult) {
  const W = strings.workspace
  // A chunk download reports nothing, so there is no number to show. A bar
  // pinned at 0% reads as BROKEN — worse than no bar — and "0%" is a claim the
  // loader never made. Determinate only when something actually measured it.
  const determinate = phase === 'assets'
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas p-6">
      <div className="max-w-sm rounded-xl border border-line bg-panel p-6 text-center shadow-sm">
        <h2 className={`text-[15px] font-semibold text-ink ${determinate ? 'mb-3' : ''}`}>
          <span className={determinate ? undefined : 'animate-pulse'}>
            {determinate ? W.loading3dAssets : W.loading3dModule}
          </span>
        </h2>
        {determinate && (
          <>
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
            <p className="ltr-nums mt-2 text-[13px] text-ink-soft">
              {W.loading3dPercent(Math.round(percent))}
            </p>
          </>
        )}
        {slow && <p className="mt-2 text-[13px] text-ink-soft">{W.loading3dSlow}</p>}
      </div>
    </div>
  )
}
