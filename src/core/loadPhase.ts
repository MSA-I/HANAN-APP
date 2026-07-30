/**
 * What the 3D loading card says, and how full its bar is.
 *
 * Two things are being loaded and the user should only ever see one bar: the
 * lazy `Scene3D` chunk (`app/App.tsx` wraps it in a `Suspense`), and then the
 * GLBs and HDRIs that chunk asks for once it is running.
 *
 * THE BAR MUST NEVER GO BACKWARDS. drei's `useProgress().progress` resets to 0
 * every time a new loader registers, so a venue pack that pulls its props in two
 * batches drives the bar 0→60, 0→100 — and a bar that jumps back reads as a bug
 * even when the load is perfectly healthy. This is fixed WITHOUT hidden state by
 * making the previous percent an input: the caller keeps it (it is already
 * holding React state to render with), and the function stays a pure map from
 * "what is true now" to "what to draw". That also means the caller owns the
 * RESET — starting a fresh load means passing `prevPercent: 0` again, which is
 * the one thing a module-level `let` could not have got right when the user
 * switches venues twice.
 */

export interface LoadPhaseInput {
  /** the lazy chunk has finished importing */
  moduleReady: boolean
  /** drei `useProgress().active` — at least one loader is running */
  active: boolean
  /** drei `useProgress().progress`, 0–100 */
  progress: number
  /** drei `useProgress().total` — how many items the current batch registered */
  total: number
  /** ms since this load began */
  elapsedMs: number
  /** what this function returned last frame; 0 when a load has just started */
  prevPercent: number
}

export interface LoadPhaseResult {
  phase: 'module' | 'assets' | 'ready'
  /** 0–100, monotonically non-decreasing for as long as `prevPercent` is fed back */
  percent: number
  /** the load is taking long enough to be worth apologising for */
  slow: boolean
}

/**
 * A load that has run this long is not "about to finish" — it is a big venue on a
 * thin connection, and the card should say so rather than leave a bar sitting
 * still. Reaching the mark is enough; a strictly-greater test would need a timer
 * to fire at 6001 ms to flip it.
 */
export const SLOW_AFTER_MS = 6000

export function loadPhase(input: LoadPhaseInput): LoadPhaseResult {
  const floor = clampPercent(input.prevPercent)

  if (!input.moduleReady) {
    // The chunk is an opaque download — no bytes to count. Hold whatever the bar
    // already showed (0 at the start of a load) rather than inventing motion.
    return { phase: 'module', percent: floor, slow: isSlow(input.elapsedMs) }
  }

  if (input.active) {
    // `total === 0` means no loader has registered yet, so `progress` is not
    // about anything. Hold the bar: an indeterminate moment shows as "not
    // moving", never as a number the loader did not report.
    const measured = input.total > 0 ? clampPercent(input.progress) : floor
    return { phase: 'assets', percent: Math.max(floor, measured), slow: isSlow(input.elapsedMs) }
  }

  return { phase: 'ready', percent: 100, slow: false }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function isSlow(elapsedMs: number): boolean {
  return Number.isFinite(elapsedMs) && elapsedMs >= SLOW_AFTER_MS
}
