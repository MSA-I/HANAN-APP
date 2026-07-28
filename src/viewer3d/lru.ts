/**
 * A Map with a ceiling.
 *
 * The viewer's geometry and material caches are keyed by `catalogId|WxDxH`, and
 * every size the user tries adds a permanent entry — resize one table through
 * forty values and forty merged geometries stay resident for the rest of the
 * session. That is a real leak, not a theoretical one (AGENT-BRIEF §1.8).
 *
 * Map iteration order IS insertion order, so the oldest live entry is simply the
 * first key: a `get` that deletes and re-inserts moves an entry to the back, and
 * an insert past the ceiling evicts from the front. That is the whole LRU.
 *
 * `onEvict` disposes the GPU resource. Evicting something still on screen is
 * safe — three re-uploads from the attribute arrays, which stay in JS memory —
 * so the worst case is a frame hitch, never a black object. The ceilings are set
 * well above any plausible working set precisely so that stays hypothetical.
 *
 * ponytail: a plain count ceiling, not a byte budget. A 200-entry cache of
 * chandeliers is a different amount of memory than 200 chairs; sizing by
 * `geometry.attributes.position.count` would be the honest version.
 */
export class LruCache<V> {
  private readonly entries = new Map<string, V>()

  constructor(
    private readonly limit: number,
    private readonly onEvict?: (value: V) => void,
  ) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      const evicted = this.entries.get(oldest.value)
      this.entries.delete(oldest.value)
      if (evicted !== undefined) this.onEvict?.(evicted)
    }
  }

  get size(): number {
    return this.entries.size
  }
}
