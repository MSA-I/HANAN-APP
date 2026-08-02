/**
 * The derivation point of PLAN-03. Everything the app knows about zones comes
 * through `effectiveZones`, so this file guards three separate promises:
 *
 *  - exactly ONE ceremony pad survives, and it is the right one of the two;
 *  - NOTHING ELSE about the list changes — same members, same order. The pack's
 *    array order is load-bearing (venuePacks.ts:144-150), so a filter that
 *    quietly re-sorted would move a push-out sequence the clamp depends on;
 *  - the same question twice gives back the same ARRAY. Two 3D consumers read
 *    this on every frame of a drag through subscriptions written to bail out on
 *    an unchanged reference, and a fresh array per call turns them into churn.
 */
import { describe, expect, it } from 'vitest'
import { getVenuePack, VENUE_PACKS } from '../venuePacks'
import { addObject, newProject, setChuppahLocation } from '../../state/actions'
import { useEditorStore } from '../../state/store'
import { isZoneInside } from './zoneOccupancy'
import { chuppahLocationOf, chuppahOnDeck, effectiveZones, zonesFor } from './venueZones'

const pack = getVenuePack('resort')!
const raw = pack.restricted!
const DECK = raw.find((z) => z.kind === 'kabalatPanim')!
const PADS = raw.filter((z) => z.kind === 'chuppah')
const HALL_PAD = PADS.find((z) => !isZoneInside(z, DECK))!
const DECK_PAD = PADS.find((z) => isZoneInside(z, DECK))!
const scene = () => useEditorStore.getState().scene

describe('effectiveZones keeps exactly one ceremony pad', () => {
  it('the pack itself carries two, which is what makes the choice possible', () => {
    expect(PADS).toHaveLength(2)
    expect(HALL_PAD).not.toBe(DECK_PAD)
  })

  it("'hall' keeps the hall's rectangle and only it", () => {
    const pads = zonesFor('resort', 'hall').filter((z) => z.kind === 'chuppah')
    expect(pads).toEqual([HALL_PAD])
    expect(isZoneInside(pads[0], DECK)).toBe(false)
  })

  it("'reception' keeps the deck's rectangle and only it", () => {
    const pads = zonesFor('resort', 'reception').filter((z) => z.kind === 'chuppah')
    expect(pads).toEqual([DECK_PAD])
    expect(isZoneInside(pads[0], DECK)).toBe(true)
  })

  it('leaves every other rectangle byte-identical and in the same order', () => {
    const others = (location: 'hall' | 'reception') =>
      zonesFor('resort', location).filter((z) => z.kind !== 'chuppah')
    const fromPack = raw.filter((z) => z.kind !== 'chuppah')
    expect(others('hall')).toEqual(fromPack)
    expect(others('reception')).toEqual(fromPack)
    // identity, not just equality: nothing is copied or rebuilt
    expect(others('hall').every((z, i) => z === fromPack[i])).toBe(true)
  })

  it('gives the procedural room an empty list, and the same one every time', () => {
    expect(zonesFor(null, 'hall')).toEqual([])
    expect(zonesFor(null, 'hall')).toBe(zonesFor(null, 'reception'))
  })

  /**
   * A venue that does not offer the choice must come through UNTOUCHED, and
   * untouched is asserted as identity rather than equality: the pack's own array
   * back, not a copy of it. The resort is the only real pack and it has two pads,
   * so the branch is reached through a throwaway registered for the length of
   * this test — the alternative is leaving the else-branch of the whole feature
   * unexercised until a second venue arrives and takes it by surprise.
   */
  it.each([
    ['one ceremony pad', [{ x: 0, y: 0, width: 100, depth: 100, kind: 'chuppah' }]],
    [
      'two pads but no reception deck',
      [
        { x: 0, y: 0, width: 100, depth: 100, kind: 'chuppah' },
        { x: 400, y: 0, width: 100, depth: 100, kind: 'chuppah' },
      ],
    ],
  ])('hands back the pack’s OWN array for a venue with %s', (name, restricted) => {
    const id = `test-${name.replace(/\s+/g, '-')}`
    VENUE_PACKS.push({
      id,
      name,
      model: '',
      offset: [0, 0, 0],
      size: { width: 1000, depth: 1000 },
      wallHeight: 300,
      restricted,
    })
    try {
      expect(zonesFor(id, 'hall')).toBe(restricted)
      expect(zonesFor(id, 'reception')).toBe(restricted)
    } finally {
      VENUE_PACKS.splice(
        VENUE_PACKS.findIndex((p) => p.id === id),
        1,
      )
    }
  })

  it('answers the same question with the same ARRAY', () => {
    expect(zonesFor('resort', 'hall')).toBe(zonesFor('resort', 'hall'))
    expect(zonesFor('resort', 'reception')).toBe(zonesFor('resort', 'reception'))
    expect(zonesFor('resort', 'hall')).not.toBe(zonesFor('resort', 'reception'))
  })

  it('reports which pad is live, which is what `allowedOnDeck` is told', () => {
    expect(chuppahOnDeck(zonesFor('resort', 'hall'))).toBe(false)
    expect(chuppahOnDeck(zonesFor('resort', 'reception'))).toBe(true)
  })
})

describe('the default when the project never said', () => {
  it("is 'hall' for an empty scene, with or without the field written down", () => {
    newProject({ name: 'default', venuePackId: 'resort' })
    // the factory materializes it — see the note there, it is a measured saving
    expect(scene().settings.chuppahLocation).toBe('hall')
    expect(chuppahLocationOf(scene())).toBe('hall')
    expect(effectiveZones(scene())).toBe(zonesFor('resort', 'hall'))
    // and the derivation agrees when the field is not there at all
    useEditorStore.setState((s) => {
      delete s.scene.settings.chuppahLocation
    })
    expect(chuppahLocationOf(scene())).toBe('hall')
    expect(effectiveZones(scene())).toBe(zonesFor('resort', 'hall'))
  })

  /**
   * DECISIONS.md 2026-08-02, and the reason the default is content-dependent: a
   * project saved before the field existed, with its canopy on the deck's pad,
   * must not open with that pad deleted from under it. The first edit would
   * re-clamp the canopy and teleport it 28 m west. Nothing is written to the
   * file and SCHEMA_VERSION does not move — this is a derivation.
   */
  it("is 'reception' for a file whose canopy already stands on the deck pad", () => {
    newProject({ name: 'legacy', venuePackId: 'resort' })
    setChuppahLocation('reception')
    const id = addObject('chuppah.draped-white', {
      x: DECK_PAD.x + DECK_PAD.width / 2,
      y: DECK_PAD.y + DECK_PAD.depth / 2,
    })
    expect(id).toBeTruthy()
    // now forget the stored value, exactly as an old file would arrive
    useEditorStore.setState((s) => {
      delete s.scene.settings.chuppahLocation
    })
    expect(scene().settings.chuppahLocation).toBeUndefined()
    expect(chuppahLocationOf(scene())).toBe('reception')
  })

  it('is unaffected by a canopy standing in the hall', () => {
    newProject({ name: 'legacy-hall', venuePackId: 'resort' })
    addObject('chuppah.draped-white', { x: 300, y: 300 })
    useEditorStore.setState((s) => {
      delete s.scene.settings.chuppahLocation
    })
    expect(chuppahLocationOf(scene())).toBe('hall')
  })

  it('lets a stored value override what the scene contains', () => {
    newProject({ name: 'stored', venuePackId: 'resort' })
    setChuppahLocation('reception')
    expect(chuppahLocationOf(scene())).toBe('reception')
    setChuppahLocation('hall')
    expect(chuppahLocationOf(scene())).toBe('hall')
  })
})
