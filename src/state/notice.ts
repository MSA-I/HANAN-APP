/**
 * One transient line of feedback, rendered by the StatusBar.
 *
 * Several actions used to fail silently — applying a design to a locked table,
 * applying a saved layout to the wrong venue — and "nothing happened" is
 * indistinguishable from "the button is broken" (source doc §23). This is the
 * smallest thing that can say why.
 *
 * ponytail: one slot, last message wins, no queue and no severities. A real
 * toast stack is warranted when something needs an action button in it.
 */
import { create } from 'zustand'

export const NOTICE_MS = 4000

interface NoticeState {
  message: string
  /** bumped on every notify so repeating the same text restarts the timer */
  seq: number
}

export const useNoticeStore = create<NoticeState>(() => ({ message: '', seq: 0 }))

export function notify(message: string): void {
  useNoticeStore.setState((s) => ({ message, seq: s.seq + 1 }))
}

export function clearNotice(): void {
  useNoticeStore.setState({ message: '' })
}
