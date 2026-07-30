/**
 * The toast stack, as a reducer. Plain array in, plain array out.
 *
 * It replaces the one-slot `state/notice.ts`, whose own header names the trigger:
 * "a real toast stack is warranted when something needs an action button in it".
 * Round 4 has one — an undo affordance on the notice that says what was refused —
 * and a single slot cannot hold a message the user is meant to act on while the
 * next mouse move overwrites it.
 *
 * THE CALLER OWNS THE CLOCK. There is no `Date.now()` in this file: every
 * function that needs "now" is handed it. That is not test sugar — it is what
 * lets a store tick the whole stack from one interval, and it is why every case
 * below can be stated as an equality instead of a `setTimeout`.
 *
 * Nothing here knows any text. `message` is already-resolved copy and
 * `action.labelKey` is a key the UI resolves, so `ui/strings.ts` is not imported
 * and the module stays node-safe.
 */

export type Tone = 'info' | 'warn' | 'error'

/** The undo affordance: a label key plus how deep to unwind if it is pressed. */
export interface NoticeAction {
  labelKey: string
  undoDepth: number
}

export interface Notice {
  id: string
  message: string
  tone: Tone
  ttlMs: number
  /** ms on the caller's clock; `expire` measures against it */
  raisedAt: number
  action?: NoticeAction
}

/**
 * Four toasts is a wall, and the fourth is the one covering the thing the user is
 * looking at. Three, oldest evicted.
 */
export const MAX_VISIBLE = 3

/**
 * Repeats of the same message inside this window bump the one on screen instead
 * of stacking. 800 ms is comfortably longer than a mouse-move burst and shorter
 * than a deliberate second attempt — the placement ghost re-raises its violation
 * on EVERY mousemove, so without this a slow drag along a wall fills the stack
 * with three copies of one sentence and evicts everything else.
 */
export const DEDUPE_MS = 800

const TTL_BY_TONE: Record<Tone, number> = { info: 4000, warn: 6000, error: 8000 }

/** A notice with something to press is read AND acted on, so it gets the long life. */
const TTL_WITH_ACTION = 8000

export function ttlFor(tone: Tone, hasAction: boolean): number {
  return hasAction ? TTL_WITH_ACTION : TTL_BY_TONE[tone]
}

/**
 * Raise a notice.
 *
 * Dedupe: if the same `message` is already on screen and was raised less than
 * `DEDUPE_MS` ago, the EXISTING entry is kept and only its `raisedAt` moves to
 * `now`. Keeping the entry (rather than replacing it with the new one) keeps its
 * `id` stable, and the id is the React key — swapping it would unmount and
 * remount the toast, restarting its entrance animation on every mouse move.
 *
 * The bump does NOT reorder. A repeated warning stays where it is and can still
 * be evicted by three newer notices, which is the behaviour that matters: a
 * violation the user is ignoring must not be able to pin itself to the stack.
 */
export function push(list: Notice[], notice: Notice, now: number): Notice[] {
  const index = list.findIndex((n) => n.message === notice.message && now - n.raisedAt < DEDUPE_MS)
  if (index >= 0) {
    const next = list.slice()
    next[index] = { ...list[index], raisedAt: now }
    return next
  }
  const next = [...list, { ...notice, raisedAt: now }]
  // eviction is by POSITION, and position is insert order — see the note above
  // about the dedupe bump deliberately not promoting an entry
  return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next
}

/** Remove one notice by id. Returns the SAME array when there was nothing to remove. */
export function dismiss(list: Notice[], id: string): Notice[] {
  const next = list.filter((n) => n.id !== id)
  return next.length === list.length ? list : next
}

/**
 * Drop everything whose time is up. A notice dies when `now - raisedAt` REACHES
 * its ttl, so a `ttlMs` of 0 is gone on the next sweep rather than immortal.
 *
 * Returns the SAME array when nothing expired. This runs on an interval a few
 * times a second; a fresh array every tick would re-render the stack forever, and
 * a stack that animates would never settle.
 */
export function expire(list: Notice[], now: number): Notice[] {
  const next = list.filter((n) => now - n.raisedAt < n.ttlMs)
  return next.length === list.length ? list : next
}
