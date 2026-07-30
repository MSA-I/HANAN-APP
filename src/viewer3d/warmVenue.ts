/**
 * Fetches the venue GLB into the HTTP cache while the browser is idle, so that
 * when the user does open 3D the 5,380,184 bytes of `venue.glb` are already on
 * disk and `useGLTF` resolves from cache instead of from the network.
 *
 * ⚠ DELIBERATELY DEPENDENCY-LIGHT. It imports `core/venuePacks` and nothing
 * else — no three, no drei, no R3F. That is the whole point: this has to be
 * callable from the app shell WITHOUT dragging the 1,157 kB 3D chunk in with it,
 * which would turn a prefetch into the very download it is trying to hide.
 *
 * It is a bare `fetch`, not `useGLTF.preload`. `useGLTF.preload` would parse the
 * GLB and build three.js objects — that is CPU work on the main thread for a
 * view the user may never open, and the parse is not the slow part anyway. A
 * `fetch` warms exactly the byte transfer, which is.
 *
 * `low` priority and an idle callback, so it can never compete with the project
 * the user is actually loading. Safari has no `requestIdleCallback`; the timeout
 * fallback is deliberately long for the same reason.
 */
import { getVenuePack } from '../core/venuePacks'

let warmed: string | null = null

type IdleWindow = typeof window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
}

/**
 * Warm the GLB for `venuePackId`. Safe to call repeatedly — it runs once per
 * pack per session, and switching venues warms the new one.
 *
 * Returns a cancel function so a caller that unmounts (or switches pack again
 * before the idle slot arrives) does not fire a stale fetch.
 */
export function warmVenueModel(venuePackId: string | null | undefined): () => void {
  if (!venuePackId || warmed === venuePackId) return () => {}
  const url = getVenuePack(venuePackId)?.model
  if (!url) return () => {}

  let cancelled = false
  const run = () => {
    if (cancelled) return
    warmed = venuePackId
    // failures are ignored on purpose: this is a cache warm, and the real load
    // will surface any genuine problem with its own error path
    void fetch(url, { priority: 'low' } as RequestInit).catch(() => {
      // a failed warm must not poison the retry — the real load still has to try
      if (warmed === venuePackId) warmed = null
    })
  }

  const idle = (window as IdleWindow).requestIdleCallback
  const timer = idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 2000)
  return () => {
    cancelled = true
    if (!idle) window.clearTimeout(timer)
  }
}
