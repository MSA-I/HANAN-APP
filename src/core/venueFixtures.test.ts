/**
 * What the bake button writes. The endpoint itself (a dev-only vite middleware)
 * is exercised by hand; the part worth pinning is the generated source, because
 * a re-bake that produces different ids turns every save into a diff.
 */
import { describe, expect, it } from 'vitest'
import { bakeSource } from '../../tools/bake-plugin'
import { createObject } from './model/factory'
import { VENUE_FIXTURES } from './venueFixtures'

const NOW = '2026-07-28T00:00:00.000Z'

describe('bake output', () => {
  it('numbers ids deterministically and freezes every object', () => {
    const objects = [
      createObject('bar.straight', { x: 100, y: 200 }),
      createObject('table.round', { x: 300, y: 400 }),
    ]
    const first = bakeSource('resort', objects, NOW)
    // same input, fresh nanoid identities — the file must not change
    const second = bakeSource(
      'resort',
      [createObject('bar.straight', { x: 100, y: 200 }), createObject('table.round', { x: 300, y: 400 })],
      NOW,
    )

    expect(first).toBe(second)
    expect(first).toContain('"id":"fixture-resort-001"')
    expect(first).toContain('"id":"fixture-resort-002"')
    expect(first).not.toContain(objects[0].id)
    expect(first.match(/"frozen":true/g)).toHaveLength(2)
    expect(first.match(/"fixture":true/g)).toHaveLength(2)
    expect(first).toContain('AUTO-GENERATED')
    expect(first).toContain(`venue: resort`)
  })

  it('quotes the venue key so it can only ever be a record key', () => {
    expect(bakeSource('resort', [], NOW)).toContain('"resort": [')
  })

  it('ships empty — nothing is baked into the repo for the user', () => {
    expect(VENUE_FIXTURES).toEqual({})
  })
})
