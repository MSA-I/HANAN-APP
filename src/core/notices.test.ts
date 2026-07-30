/**
 * The toast stack reducer.
 *
 * Not one `setTimeout` and not one `Date.now()` in this file: the module takes
 * the clock as a parameter, so every timing claim below is an equality on a
 * number the test chose. That is the reason the reducer is pure at all — the
 * previous one-slot notice had no timing test whatsoever, because there was no
 * way to write one that did not sleep.
 */
import { describe, expect, it } from 'vitest'
import {
  DEDUPE_MS,
  MAX_VISIBLE,
  dismiss,
  expire,
  push,
  ttlFor,
  type Notice,
  type Tone,
} from './notices'

let seq = 0
const notice = (message: string, tone: Tone = 'info', action?: Notice['action']): Notice => ({
  id: `n${++seq}`,
  message,
  tone,
  ttlMs: ttlFor(tone, !!action),
  raisedAt: 0,
  action,
})

const messages = (list: readonly Notice[]) => list.map((n) => n.message)

describe('how long a notice lives', () => {
  it('grows with how much it has to say', () => {
    expect(ttlFor('info', false)).toBe(4000)
    expect(ttlFor('warn', false)).toBe(6000)
    expect(ttlFor('error', false)).toBe(8000)
  })

  it('gives anything with a button the longest life, whatever its tone', () => {
    for (const tone of ['info', 'warn', 'error'] as Tone[]) {
      expect(ttlFor(tone, true)).toBe(8000)
      expect(ttlFor(tone, true)).toBeGreaterThanOrEqual(ttlFor(tone, false))
    }
  })
})

describe('raising a notice', () => {
  it('appends, stamped with the clock the caller passed in', () => {
    const one = push([], notice('placed'), 1000)
    expect(one).toHaveLength(1)
    expect(one[0].raisedAt).toBe(1000)

    const two = push(one, notice('rotated'), 1200)
    expect(messages(two)).toEqual(['placed', 'rotated'])
  })

  it('never mutates the list it was given', () => {
    const before: Notice[] = [notice('placed')]
    const snapshot = [...before]
    push(before, notice('rotated'), 100)
    expect(before).toEqual(snapshot)
  })

  it('caps the stack and evicts exactly the oldest', () => {
    let list: Notice[] = []
    for (let i = 1; i <= MAX_VISIBLE; i++) list = push(list, notice(`m${i}`), i * 100)
    expect(list).toHaveLength(MAX_VISIBLE)

    list = push(list, notice('newest'), 1000)
    expect(list).toHaveLength(MAX_VISIBLE)
    expect(messages(list)).toEqual(['m2', 'm3', 'newest'])
  })

  it('keeps evicting one at a time however many arrive', () => {
    let list: Notice[] = []
    for (let i = 1; i <= 10; i++) {
      list = push(list, notice(`m${i}`), i * 100)
      expect(list.length).toBeLessThanOrEqual(MAX_VISIBLE)
    }
    expect(messages(list)).toEqual(['m8', 'm9', 'm10'])
  })
})

/**
 * The case this whole reducer was shaped around: the placement ghost re-raises
 * its violation on every mousemove, so a slow drag along a wall is a hundred
 * pushes of one sentence.
 */
describe('a message that repeats', () => {
  it('bumps the entry on screen instead of stacking a second copy', () => {
    const first = push([], notice('too close to the wall'), 1000)
    const again = push(first, notice('too close to the wall'), 1000 + DEDUPE_MS - 1)

    expect(again).toHaveLength(1)
    expect(again[0].id).toBe(first[0].id) // same React key — the toast does not remount
    expect(again[0].raisedAt).toBe(1000 + DEDUPE_MS - 1) // …with a fresh timer
  })

  it('survives a whole drag as one entry', () => {
    let list: Notice[] = []
    for (let t = 0; t < 3000; t += 16) list = push(list, notice('too close to the wall'), t)
    expect(list).toHaveLength(1)
    expect(list[0].raisedAt).toBe(2992)
  })

  it('stacks again once the window has passed', () => {
    const first = push([], notice('too close to the wall'), 1000)
    const later = push(first, notice('too close to the wall'), 1000 + DEDUPE_MS)
    expect(later).toHaveLength(2)
  })

  it('does not reorder — a repeat stays where it is and can still be evicted', () => {
    let list = push([], notice('repeating'), 0)
    list = push(list, notice('b'), 100)
    list = push(list, notice('repeating'), 200) // bump, not a move
    expect(messages(list)).toEqual(['repeating', 'b'])

    list = push(list, notice('c'), 300)
    list = push(list, notice('d'), 400)
    expect(messages(list)).toEqual(['b', 'c', 'd']) // the repeat did not pin itself
  })

  it('only dedupes an identical message', () => {
    const list = push(push([], notice('wall'), 0), notice('wall '), 10)
    expect(list).toHaveLength(2)
  })
})

describe('dismissing', () => {
  it('removes the one asked for and leaves the rest in order', () => {
    let list = push([], notice('a'), 0)
    list = push(list, notice('b'), 10)
    list = push(list, notice('c'), 20)

    const after = dismiss(list, list[1].id)
    expect(messages(after)).toEqual(['a', 'c'])
  })

  it('hands the same array back when there was nothing to remove', () => {
    const list = push([], notice('a'), 0)
    expect(dismiss(list, 'no-such-id')).toBe(list)
    expect(dismiss([], 'anything')).toEqual([])
  })
})

describe('expiring', () => {
  it('keeps a notice until its ttl is reached, then drops it', () => {
    const list = push([], notice('info one', 'info'), 1000)
    const ttl = ttlFor('info', false)

    expect(expire(list, 1000)).toHaveLength(1)
    expect(expire(list, 1000 + ttl - 1)).toHaveLength(1)
    expect(expire(list, 1000 + ttl)).toHaveLength(0) // reaching the ttl is the end of it
  })

  it('drops them in the order their tones earn', () => {
    let list = push([], notice('quiet', 'info'), 0)
    list = push(list, notice('careful', 'warn'), 0)
    list = push(list, notice('broken', 'error'), 0)

    expect(messages(expire(list, 4000))).toEqual(['careful', 'broken'])
    expect(messages(expire(list, 6000))).toEqual(['broken'])
    expect(expire(list, 8000)).toHaveLength(0)
  })

  it('empties the stack for a sweep far in the future', () => {
    let list = push([], notice('a'), 0)
    list = push(list, notice('b', 'error'), 0)
    expect(expire(list, Number.MAX_SAFE_INTEGER)).toEqual([])
  })

  it('hands the same array back when nothing expired', () => {
    const list = push([], notice('a'), 1000)
    expect(expire(list, 1000)).toBe(list)
    expect(expire([], 999999)).toEqual([])
  })

  it('drops a zero-ttl notice on the next sweep rather than keeping it forever', () => {
    const list = push([], { ...notice('flash'), ttlMs: 0 }, 500)
    expect(expire(list, 500)).toHaveLength(0)
  })

  /** A dedupe bump is a fresh timer — the entry must outlive its original ttl. */
  it('gives a bumped notice its full life again', () => {
    const ttl = ttlFor('info', false)
    let list = push([], notice('repeating'), 0)
    list = push(list, notice('repeating'), 500)
    expect(expire(list, ttl + 400)).toHaveLength(1)
    expect(expire(list, ttl + 500)).toHaveLength(0)
  })
})

describe('a notice with an action', () => {
  it('carries the label key and the undo depth through untouched', () => {
    const action = { labelKey: 'undo', undoDepth: 2 }
    const list = push([], notice('four tables moved', 'warn', action), 0)
    expect(list[0].action).toEqual(action)
    expect(list[0].ttlMs).toBe(ttlFor('warn', true))
  })

  it('outlives the plain warning it would otherwise be', () => {
    const withAction = push([], notice('moved', 'warn', { labelKey: 'undo', undoDepth: 1 }), 0)
    const without = push([], notice('moved too', 'warn'), 0)
    expect(expire(withAction, 6000)).toHaveLength(1)
    expect(expire(without, 6000)).toHaveLength(0)
  })
})
