/**
 * The toast stack's store: `core/notices.ts` plus a clock.
 *
 * The old header of this file said it was "one slot, last message wins, no queue
 * and no severities" and named its own successor: "a real toast stack is
 * warranted when something needs an action button in it". Round 4 has one — a
 * destructive action that says so and offers to take itself back — so this is
 * now a thin store over the reducer, and nothing else about the file moved:
 * same path, same `notify` name, same `useNoticeStore` export.
 *
 * THE REDUCER STAYS PURE. Every `Date.now()` in the toast system is in this
 * file; `core/notices.ts` is handed the time it needs. That split is what lets
 * `freeze`/`thaw` exist at all — pausing is just "give the held milliseconds
 * back to every `raisedAt`", which is impossible if the reducer reads its own
 * clock.
 *
 * NOTHING AGES WITHOUT A RENDERER. There is no interval here: `NoticeStack`
 * owns the tick and only while it is mounted. A module-level interval would
 * outlive every node test that happens to raise a notice, and 14 call sites do.
 */
import { create } from 'zustand'
import { dismiss as dismissFrom, expire, push, ttlFor, type Notice, type Tone } from '../core/notices'
import { temporalStore } from './store'

export type { Notice, Tone } from '../core/notices'

/**
 * The old single-slot lifetime, kept because it is exported. Live TTLs now come
 * from `ttlFor(tone, hasAction)`, and this is what that returns for `info`.
 */
export const NOTICE_MS = 4000

/** `ui/strings.ts` path the stack resolves for an action button's label. */
export const UNDO_LABEL_KEY = 'notice.undo'

export interface NoticeOptions {
  /**
   * Default `warn`, not `info`, because all 14 existing `notify()` calls are
   * refusals and the footer rendered every one of them in warning colours.
   * Keeping the colour costs 2s of extra life (warn is 6000, info 4000).
   */
  tone?: Tone
  /**
   * Offer an undo button. Raising it captures the undo history depth NOW, and
   * the button disables itself if that depth has moved — see `undoDepth` below.
   */
  undo?: boolean
  /** Override the tone's lifetime. For tests and for the rare pinned message. */
  ttlMs?: number
}

interface NoticeState {
  /** oldest first — `NoticeStack` renders in this order, so newest is bottom */
  list: Notice[]
  /**
   * LEGACY. The text of the most recently raised notice, never cleared by a
   * timer. `core/layout/collision.test.ts` and `state/savedLayouts.test.ts`
   * assert on this field and neither file belongs to this plan, so the shape
   * they read stays. It is also genuinely the cheapest way to ask "what did the
   * app last refuse", which is all those tests want.
   */
  message: string
  /** LEGACY, same reason: bumped on every raise, including a deduped one. */
  seq: number
  /** when the stack was frozen, on the same clock as `raisedAt`; null = running */
  frozenAt: number | null
}

export const useNoticeStore = create<NoticeState>(() => ({
  list: [],
  message: '',
  seq: 0,
  frozenAt: null,
}))

/** Ids only have to be unique within one page load, and they are React keys. */
let nextId = 0

/**
 * Raise a notice.
 *
 * The signature is additive on purpose: `notify(message)` is unchanged for all
 * 14 existing call sites, several of which sit in files other plans are editing
 * right now.
 */
export function notify(message: string, options: NoticeOptions = {}): void {
  const tone = options.tone ?? 'warn'
  const hasUndo = options.undo === true
  const now = Date.now()
  const notice: Notice = {
    id: `notice-${++nextId}`,
    message,
    tone,
    ttlMs: options.ttlMs ?? ttlFor(tone, hasUndo),
    raisedAt: now,
    action: hasUndo
      ? {
          labelKey: UNDO_LABEL_KEY,
          // NOT "how many steps to unwind" — the history depth as it stands at
          // this instant. The button undoes exactly one step and only while the
          // depth still matches, because an undo button that fires after the
          // user has done something else undoes the wrong thing.
          undoDepth: temporalStore.getState().pastStates.length,
        }
      : undefined,
  }
  useNoticeStore.setState((s) => ({
    list: push(s.list, notice, now),
    message,
    seq: s.seq + 1,
  }))
}

/** Remove one notice — the dismiss button, or the undo button after it fires. */
export function dismissNotice(id: string): void {
  // returning the same state object is a real no-op in zustand (it compares
  // with Object.is before notifying), which is why `dismiss` bothers to return
  // the same array reference when nothing matched
  useNoticeStore.setState((s) => {
    const list = dismissFrom(s.list, id)
    return list === s.list ? s : { ...s, list }
  })
}

/** Drop the whole stack. */
export function clearNotice(): void {
  useNoticeStore.setState({ list: [], message: '' })
}

/** One sweep of the clock. `NoticeStack` calls this on an interval. */
export function expireNotices(now: number = Date.now()): void {
  useNoticeStore.setState((s) => {
    if (s.frozenAt !== null) return s
    const list = expire(s.list, now)
    return list === s.list ? s : { ...s, list }
  })
}

/** Stop the stack ageing — the pointer is over it and someone is reading. */
export function freezeNotices(now: number = Date.now()): void {
  useNoticeStore.setState((s) => (s.frozenAt === null ? { ...s, frozenAt: now } : s))
}

/**
 * Resume. The held time is GIVEN BACK rather than merely un-paused: every
 * notice ages from `raisedAt`, so moving each one forward by the pause length
 * preserves its exact remaining life. Without this, hovering a stack for six
 * seconds would make all three expire the instant the pointer left.
 */
export function thawNotices(now: number = Date.now()): void {
  useNoticeStore.setState((s) => {
    if (s.frozenAt === null) return s
    const held = now - s.frozenAt
    return {
      ...s,
      frozenAt: null,
      list: held > 0 ? s.list.map((n) => ({ ...n, raisedAt: n.raisedAt + held })) : s.list,
    }
  })
}
