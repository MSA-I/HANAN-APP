/**
 * What the bake button writes. The endpoint itself (a dev-only vite middleware)
 * is exercised by hand; the part worth pinning is the generated source, because
 * a re-bake that produces different ids turns every save into a diff.
 */
import { describe, expect, it } from 'vitest'
import { bakeSource } from '../../tools/bake-plugin'
import { isEffectivelyLocked, isFrozen } from '../state/selectors'
import { getCatalogEntry, listByCategory } from './catalog/registry'
import { createDefaultScene, createObject, venueFixtures } from './model/factory'
import type { Id, SceneObject } from './model/types'
import { VENUE_FIXTURES } from './venueFixtures'

const NOW = '2026-07-28T00:00:00.000Z'

function requireId(id: string | undefined, what: string): string {
  if (!id) throw new Error(`the catalog no longer offers a ${what}; this test needs one`)
  return id
}

const TABLE_ID = 'table.round'
const CHAIR_ID = requireId(getCatalogEntry(TABLE_ID).seating?.defaultChair, 'default chair')
const CENTREPIECE_ID = requireId(
  listByCategory('tableDecor').find((entry) => entry.placement === 'surface')?.id,
  'surface centrepiece',
)

function chair(parentId: Id, seatIndex: number): SceneObject {
  const object = createObject(CHAIR_ID, { x: seatIndex * 40, y: 60 })
  object.parentId = parentId
  object.attachment = { kind: 'seat', seatIndex, manual: false }
  return object
}

function surfaceDecor(parentId: Id): SceneObject {
  const object = createObject(CENTREPIECE_ID, { x: 0, y: 0 })
  object.parentId = parentId
  object.attachment = { kind: 'surface' }
  return object
}

/**
 * A dressed table, handed over the way the button hands it over: roots first (it
 * walks `objectOrder`), then whatever else is in `scene.objects`. The children
 * arrive OUT of order on purpose — centrepiece before the chairs, seat 1 before
 * seat 0 — so the emitted order proves the sort ran rather than the input order
 * happening to be right.
 */
function dressedTable(): SceneObject[] {
  const table = createObject(TABLE_ID, { x: 500, y: 400 })
  return [table, surfaceDecor(table.id), chair(table.id, 1), chair(table.id, 0)]
}

/**
 * Read the objects back out of the generated module. The generator writes one
 * object per line, which is what makes this possible without a bundler.
 */
function parseBake(source: string): SceneObject[] {
  return source
    .split('\n')
    .filter((line) => line.startsWith('    {'))
    .map((line) => JSON.parse(line.trim().replace(/,$/, '')) as SceneObject)
}

describe('bake output', () => {
  it('numbers ids deterministically and freezes every object', () => {
    const objects = [
      createObject('bar.resort-left', { x: 100, y: 200 }),
      createObject('table.round', { x: 300, y: 400 }),
    ]
    const first = bakeSource('resort', objects, NOW)
    // same input, fresh nanoid identities — the file must not change
    const second = bakeSource(
      'resort',
      [createObject('bar.resort-left', { x: 100, y: 200 }), createObject('table.round', { x: 300, y: 400 })],
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

  it('carries the resort bar, baked 2026-07-28, and every object frozen', () => {
    // This used to assert the table was empty. It is not any more, and that is the
    // point of the bake: the bar, its mirrored half and the back wall belong to the
    // hall, so they ship with the repo instead of being placed per event.
    expect(Object.keys(VENUE_FIXTURES)).toEqual(['resort'])
    expect(VENUE_FIXTURES.resort.map((o) => o.catalogId)).toEqual([
      'bar.back-wall',
      'bar.resort-left',
      'bar.resort-right',
    ])
    for (const o of VENUE_FIXTURES.resort) {
      expect(o.flags).toEqual({ locked: true, visible: true, frozen: true })
      expect(o.meta.fixture).toBe(true)
      expect(o.parentId).toBeNull()
      expect(o.id).toMatch(/^fixture-resort-\d{3}$/)
    }
  })
})

/**
 * The bake used to follow `objectOrder`, which holds TOP-LEVEL objects only, so
 * everything the user had arranged on the tables was thrown away silently
 * (source doc §5). These pin the tree it writes instead.
 */
describe('bake output — the whole tree', () => {
  it('writes the children too, re-parented into the new id space', () => {
    const sent = dressedTable()
    const baked = parseBake(bakeSource('resort', sent, NOW))

    expect(baked.map((o) => o.id)).toEqual([
      'fixture-resort-001',
      'fixture-resort-002',
      'fixture-resort-003',
      'fixture-resort-004',
    ])
    // root, then its chairs BY SEAT INDEX, then the surface decor
    expect(baked.map((o) => o.catalogId)).toEqual([TABLE_ID, CHAIR_ID, CHAIR_ID, CENTREPIECE_ID])
    expect(
      baked.map((o) => (o.attachment?.kind === 'seat' ? o.attachment.seatIndex : null)),
    ).toEqual([null, 0, 1, null])

    // Every child points at the root's NEW id. A leftover nanoid here is THE
    // failure mode and it is silent: venueFixtures either drops the child or
    // strands it at the hall origin holding a parent-relative offset.
    expect(baked.map((o) => o.parentId)).toEqual([
      null,
      'fixture-resort-001',
      'fixture-resort-001',
      'fixture-resort-001',
    ])
    const sentIds = new Set(sent.map((o) => o.id))
    for (const object of baked) {
      expect(sentIds.has(object.id)).toBe(false)
      if (object.parentId !== null) expect(sentIds.has(object.parentId)).toBe(false)
    }

    // frozen on the ROOT only — see bakeSource's header for why
    expect(baked[0].flags).toEqual({ locked: true, visible: true, frozen: true })
    for (const child of baked.slice(1)) {
      expect(child.flags).toEqual({ locked: false, visible: true })
    }
    expect(baked.every((o) => o.meta.fixture === true)).toBe(true)
  })

  it('remaps attachment.stackedOn, which points at a sibling', () => {
    const table = createObject(TABLE_ID, { x: 500, y: 400 })
    const setting = surfaceDecor(table.id)
    const napkin = surfaceDecor(table.id)
    napkin.attachment = { kind: 'surface', stackedOn: setting.id }

    const baked = parseBake(bakeSource('resort', [table, setting, napkin], NOW))
    const stacked = baked[2].attachment

    expect(stacked?.kind).toBe('surface')
    expect(stacked?.kind === 'surface' ? stacked.stackedOn : null).toBe('fixture-resort-002')
  })

  it('bakes twice to the same source, children and all', () => {
    // two arrangements built identically but with fresh nanoid identities
    expect(bakeSource('resort', dressedTable(), NOW)).toBe(bakeSource('resort', dressedTable(), NOW))
  })

  it('takes already-frozen objects back, so a re-bake is cumulative', () => {
    const first = parseBake(bakeSource('resort', dressedTable(), NOW))
    // the old button filtered isFrozen() out, so the second press wrote a file
    // that no longer held what the first press had produced
    const again = parseBake(bakeSource('resort', first, NOW))
    expect(again).toEqual(first)
  })

  it('drops a child whose parent is not in the payload rather than promoting it', () => {
    const table = createObject(TABLE_ID, { x: 500, y: 400 })
    const orphan = chair('no-such-table', 0)
    const baked = parseBake(bakeSource('resort', [table, orphan], NOW))
    // promoted, it would read its 0,60 seat offset as a hall coordinate
    expect(baked.map((o) => o.catalogId)).toEqual([TABLE_ID])
  })

  it('seeds back as a tree: root frozen, children pickable, objectOrder roots only', () => {
    const baked = parseBake(bakeSource('resort', dressedTable(), NOW))
    // `createDefaultScene` reads the module-level table and only recognises a
    // REAL pack id — an unknown one falls through to a procedural room with no
    // fixtures at all — so standing this bake in for the shipped one is the only
    // way to drive a TREE through the shipping path.
    const shipped = VENUE_FIXTURES.resort
    try {
      VENUE_FIXTURES.resort = baked
      const seeded = venueFixtures('resort')
      expect(seeded.map((o) => o.id)).toEqual(baked.map((o) => o.id))
      expect(seeded[0].parentId).toBeNull()
      // parent-relative geometry survives, or the chairs land on the origin
      expect(seeded.slice(1).map((o) => o.parentId)).toEqual([
        'fixture-resort-001',
        'fixture-resort-001',
        'fixture-resort-001',
      ])
      expect(seeded.slice(1).map((o) => o.attachment?.kind)).toEqual(['seat', 'seat', 'surface'])
      expect(seeded[0].seating?.count).toBe(getCatalogEntry(TABLE_ID).seating?.defaultCount)

      const scene = createDefaultScene(undefined, undefined, 'resort')
      // objectOrder is the top-level z-order; a listed child would be drawn a
      // second time, at its parent-relative offset from the hall's corner
      expect(scene.objectOrder).toEqual(['fixture-resort-001'])
      expect(Object.keys(scene.objects).sort()).toEqual(baked.map((o) => o.id).sort())

      // The reason children are not frozen: frozen ⇒ isEffectivelyLocked, and an
      // effectively-locked object cannot be picked in the 2D editor. Freeze the
      // chairs and the user can never dress the table again.
      const root = scene.objects['fixture-resort-001']
      expect(isFrozen(root)).toBe(true)
      expect(isEffectivelyLocked(scene, root)).toBe(true)
      for (const id of baked.slice(1).map((o) => o.id)) {
        expect(isFrozen(scene.objects[id])).toBe(false)
        expect(isEffectivelyLocked(scene, scene.objects[id])).toBe(false)
      }
    } finally {
      VENUE_FIXTURES.resort = shipped
    }
  })
})
