import { describe, expect, it } from 'vitest'
import { LruCache } from './lru'

describe('LruCache', () => {
  it('evicts the least recently used entry once past the ceiling', () => {
    const evicted: string[] = []
    const cache = new LruCache<string>(2, (v) => evicted.push(v))

    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.set('c', 'C')

    expect(evicted).toEqual(['A'])
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe('B')
    expect(cache.size).toBe(2)
  })

  it('a hit refreshes the entry, so the other one is evicted next', () => {
    const evicted: string[] = []
    const cache = new LruCache<string>(2, (v) => evicted.push(v))

    cache.set('a', 'A')
    cache.set('b', 'B')
    cache.get('a') // 'b' is now the oldest
    cache.set('c', 'C')

    expect(evicted).toEqual(['B'])
    expect(cache.get('a')).toBe('A')
  })

  it('re-setting a key does not grow the cache or evict', () => {
    const evicted: string[] = []
    const cache = new LruCache<string>(2, (v) => evicted.push(v))

    cache.set('a', 'A')
    cache.set('a', 'A2')
    cache.set('b', 'B')

    expect(evicted).toEqual([])
    expect(cache.get('a')).toBe('A2')
    expect(cache.size).toBe(2)
  })
})
