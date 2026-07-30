/**
 * Which inspector sections are open, resolved from whatever was persisted.
 *
 * PURE on purpose: the caller does the `localStorage` read and write (the
 * try/catch shape at `ui/SplitView.tsx:41-47`), this decides what the stored
 * blob MEANS. Splitting it that way is what makes it testable under
 * `environment: 'node'`, where there is no `localStorage` at all.
 *
 * `defaults` is the authority on WHICH sections exist. That is the whole design:
 * the stored value can only ever answer questions the current build is asking,
 * so a section renamed or removed between releases cannot resurrect itself, and
 * a section added since the last save opens at its default instead of closed.
 */

/**
 * `stored` is deliberately `unknown`: it is a `localStorage.getItem` result
 * (a JSON string, or `null` when nothing was ever saved), but an already-parsed
 * object is accepted too so a caller that keeps the state in memory can reuse it.
 * Everything else — malformed JSON, an array, a number, a string that parses to
 * `null` — means "no usable preference", and every section falls back.
 */
export function resolveOpenSections(
  stored: unknown,
  defaults: Record<string, boolean>,
): Record<string, boolean> {
  const saved = asRecord(stored)
  const out: Record<string, boolean> = {}
  for (const id of Object.keys(defaults)) {
    const value = saved?.[id]
    // Only a real boolean is believed. A `1`, a `"true"` or a `null` written by an
    // older build (or by hand) is not a truthiness question — it is a corrupt
    // value, and the default is a better answer than a guess.
    out[id] = typeof value === 'boolean' ? value : defaults[id]
  }
  return out
}

function asRecord(stored: unknown): Record<string, unknown> | null {
  let value = stored
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      // half-written by a tab that was closed mid-save, or edited by hand
      return null
    }
  }
  // `typeof null === 'object'`, and an array is an object too — both are shapes a
  // previous schema could have written, and neither answers "is section X open".
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
