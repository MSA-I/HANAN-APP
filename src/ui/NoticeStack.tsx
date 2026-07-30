/**
 * The toast stack. Up to three notices, newest at the bottom, stacking upward.
 *
 * WHY IT IS NOT IN THE FOOTER. The 36px status bar already carries six things,
 * and the one it used to carry here — a single last-wins line — could not hold a
 * message the user is meant to press while the next mouse move overwrote it.
 * The occupied slots over the canvas are top-centre (`DesignEditMode`,
 * `DrillBreadcrumb`), top-inline-end (the 3D camera presets) and bottom-centre
 * `bottom-3` (the 3D selection bar), so this sits at `bottom: 5.5rem` — clear of
 * the footer and clear of the 3D bar.
 *
 * HOVER PAUSES EVERYTHING. A message you cannot finish reading is a message you
 * did not receive, and these are the messages with a button in them.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import type { Notice, Tone } from '../core/notices'
import { undo } from '../state/actions'
import {
  dismissNotice,
  expireNotices,
  freezeNotices,
  notify,
  thawNotices,
  UNDO_LABEL_KEY,
  useNoticeStore,
} from '../state/notice'
import { temporalStore } from '../state/store'
import { strings } from './strings'

const S = strings.notice

/**
 * How often the stack checks the clock. Four times a second is far finer than
 * the shortest ttl (4s) and `expire` returns the same array when nothing died,
 * so a tick with nothing to do costs no render.
 */
const TICK_MS = 250

/** Tone colours the TEXT only; the surface is the app's standard panel. */
const TONE_TEXT: Record<Tone, string> = {
  info: 'text-ink',
  warn: 'text-warning',
  error: 'text-danger',
}

/** `action.labelKey` is a key so `core/notices.ts` can stay free of copy. */
function actionLabel(labelKey: string): string {
  return labelKey === UNDO_LABEL_KEY ? S.undo : labelKey
}

function NoticeRow({ notice }: { notice: Notice }) {
  // Subscribed, not read once: the button has to go dead the moment history
  // moves under it, including while this toast is on screen.
  const depth = useStore(temporalStore, (s) => s.pastStates.length)
  const action = notice.action
  // An undo that no longer lines up with what this notice is about would undo
  // somebody else's edit. Disabled beats wrong.
  const undoStale = action ? depth !== action.undoDepth : false

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border border-line bg-panel py-1 ps-1 pe-3 shadow-lg"
    >
      <span className={`min-w-0 flex-1 py-1 text-[14px] font-semibold ${TONE_TEXT[notice.tone]}`}>
        {notice.message}
      </span>
      {action && (
        <button
          type="button"
          disabled={undoStale}
          onClick={() => {
            undo()
            dismissNotice(notice.id)
          }}
          className={`min-h-8 shrink-0 rounded-md px-2.5 py-1 text-[14px] font-semibold ${
            undoStale ? 'cursor-default text-ink-soft/50' : 'text-accent hover:bg-accent-tint'
          }`}
        >
          {actionLabel(action.labelKey)}
        </button>
      )}
      <button
        type="button"
        aria-label={S.dismiss}
        onClick={() => dismissNotice(notice.id)}
        className="shrink-0 rounded p-1 text-ink-soft transition-colors hover:bg-accent-tint hover:text-ink"
      >
        <X size={14} />
      </button>
    </motion.div>
  )
}

export function NoticeStack() {
  const list = useNoticeStore((s) => s.list)
  const count = list.length

  // The tick lives here rather than in the store so that it exists only while
  // something can be seen expiring — see the header of `state/notice.ts`.
  useEffect(() => {
    if (count === 0) return
    const id = window.setInterval(() => expireNotices(), TICK_MS)
    return () => window.clearInterval(id)
  }, [count])

  // Same precedent as `window.__stage`, `window.__viewer3d` and
  // `window.__designEdit`: without a handle, verifying a toast means racing a
  // 4-second timer in a headless run. `notify` is here too because the stack's
  // own rules — caps at three, newest last — cannot be exercised without being
  // able to raise three of them on demand.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __notices?: unknown }
    w.__notices = {
      list: () => useNoticeStore.getState().list,
      freeze: () => freezeNotices(),
      thaw: () => thawNotices(),
      notify,
    }
    return () => {
      delete w.__notices
    }
  }, [])

  return (
    <div
      role="status"
      aria-live="polite"
      // `start-0 end-0` + `mx-auto w-fit` centres without naming a side, which
      // is the only centring idiom that is identical under both directions.
      className="pointer-events-none fixed bottom-[5.5rem] start-0 end-0 z-50 mx-auto flex w-fit flex-col items-center gap-2"
      onPointerEnter={() => freezeNotices()}
      onPointerLeave={() => thawNotices()}
      // keyboard users read at their own pace too, and tabbing to the undo
      // button must not start a countdown against pressing it
      onFocusCapture={() => freezeNotices()}
      onBlurCapture={() => thawNotices()}
    >
      <AnimatePresence initial={false}>
        {list.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} />
        ))}
      </AnimatePresence>
    </div>
  )
}
