/**
 * The zone list IN FORCE for one project — the single derivation point behind
 * every consumer of `VenuePack.restricted`.
 *
 * `VENUE_PACKS` is a module constant shared by every project on the machine and
 * is never mutated: the resort keeps BOTH of its ceremony rectangles, the hall's
 * (760×425, +0.50, venuePacks.ts:204) and the reception deck's (571×426, +5.20,
 * :246). What differs between projects is DERIVED here, and exactly one of the
 * two survives — "חופה למטה" keeps the hall's, "חופה למעלה" keeps the deck's.
 *
 * ⚠ Membership is GEOMETRIC, not by `kind`. Both rectangles are `kind: 'chuppah'`,
 * so the question can only be "where is this one drawn", never "what is it" —
 * the same rule, for the same reason, that VenueLayer.tsx:375-377 and
 * zoneOccupancy.ts:37-48 already argued for the 2D overlay.
 *
 * ⚠ And `filter` is the tool, not a rebuild. venuePacks.ts:144-150 and :223-236
 * document that the array's ORDER is load-bearing: the clamp's push-out loop
 * walks it in order and moves the box at every step, and two tests do
 * `find(z => z.kind === 'chuppah')` meaning the HALL one. `filter` preserves the
 * relative order of everything it keeps; sorting or rebuilding would not.
 */
import { getCatalogEntry, hasCatalogEntry } from '../catalog/registry'
import type { ChuppahLocation, SceneObject, SceneState } from '../model/types'
import { getVenuePack, type RestrictedZone } from '../venuePacks'
import { isPointInZone, isZoneInside } from './zoneOccupancy'

/** Shared empty result, so "no pack" is also reference-stable. */
const EMPTY: readonly RestrictedZone[] = Object.freeze([])

/** The scene shape this module reads. Deliberately narrow: it is called per frame. */
export type ZoneScene = Pick<SceneState, 'venue' | 'settings' | 'objects'>

/** The pad on the reception deck, when the pack draws one. */
function deckPadOf(zones: readonly RestrictedZone[]): RestrictedZone | undefined {
  const deck = zones.find((z) => z.kind === 'kabalatPanim')
  if (!deck) return undefined
  return zones.find((z) => z.kind === 'chuppah' && isZoneInside(z, deck))
}

/**
 * Is the LIVE ceremony pad the one on the deck? Asked of an already-derived list,
 * so it is the one question `allowedOnDeck` needs and the only one it gets.
 */
export function chuppahOnDeck(zones: readonly RestrictedZone[]): boolean {
  return deckPadOf(zones) !== undefined
}

/**
 * Does a canopy already stand on the deck's pad?
 *
 * Memoised on the `objects` record rather than on the scene: a settings-only edit
 * leaves that record identical, and the answer depends on nothing else. The store
 * is immer-backed, so a mutated scene always brings a NEW record and a stale entry
 * is unreachable — the same argument `indexOf` (collision.ts) makes for its cache.
 * Without it this pass would run once per subscribed component per store update,
 * and `ObjectGroup` subscribes once per object.
 */
const deckOccupancy = new WeakMap<Record<string, SceneObject>, { packId: string; on: boolean }>()

function canopyStandsOnDeckPad(scene: ZoneScene): boolean {
  const pack = getVenuePack(scene.venue.venuePackId)
  if (!pack?.restricted) return false
  const hit = deckOccupancy.get(scene.objects)
  if (hit && hit.packId === pack.id) return hit.on
  const pad = deckPadOf(pack.restricted)
  let on = false
  if (pad) {
    for (const obj of Object.values(scene.objects)) {
      if (obj.parentId) continue
      if (!hasCatalogEntry(obj.catalogId)) continue
      if (getCatalogEntry(obj.catalogId).zoneKind !== 'chuppah') continue
      // CENTRE, like every other "is it standing there" test in this folder. The
      // canopy is clamped inside its pad, so its centre is the pad's own.
      if (isPointInZone(obj.transform.position, pad)) {
        on = true
        break
      }
    }
  }
  deckOccupancy.set(scene.objects, { packId: pack.id, on })
  return on
}

/**
 * Which ceremony pad this project means.
 *
 * The stored value wins. Absent, the answer is CONTENT-DEPENDENT and that is a
 * decision, not an accident (DECISIONS.md 2026-08-02): a project saved before
 * this field existed, whose canopy stands on the deck's pad, must not open with
 * that pad deleted from under it — the first edit would re-clamp the canopy and
 * teleport it 28 m west into the hall. It is a DERIVATION and not a migration:
 * SCHEMA_VERSION does not move and nothing is written to the file.
 *
 * It cannot oscillate. With 'reception' derived, the canopy's only home is the
 * deck pad and the clamp keeps it there, so the next answer is 'reception' again;
 * with 'hall' derived the deck pad is not in the list at all, so nothing can ever
 * come to stand on it. Each answer is its own fixed point.
 */
export function chuppahLocationOf(scene: ZoneScene): ChuppahLocation {
  const stored = scene.settings.chuppahLocation
  if (stored) return stored
  return canopyStandsOnDeckPad(scene) ? 'reception' : 'hall'
}

/**
 * There are exactly two answers per pack, so they are built once and handed back
 * by REFERENCE. This is not tidiness: `Placement3D` (useShallow) and
 * `ObjectGroup` read the list on every frame of a drag, and a fresh array per
 * call turns a subscription that was written to bail out into one that never does.
 *
 * ⚠ Keyed on `${packId}|${location}` and NOTHING else, which is why the location
 * is computed outside and passed in. Folding the scene into the key would make it
 * scene-dependent and give back the churn the cache exists to remove.
 */
const zonesCache = new Map<string, readonly RestrictedZone[]>()

export function zonesFor(
  venuePackId: string | null | undefined,
  location: ChuppahLocation,
): readonly RestrictedZone[] {
  const pack = getVenuePack(venuePackId)
  if (!pack?.restricted) return EMPTY
  const key = `${pack.id}|${location}`
  const hit = zonesCache.get(key)
  if (hit) return hit
  const built = buildZones(pack.restricted, location)
  zonesCache.set(key, built)
  return built
}

function buildZones(
  zones: readonly RestrictedZone[],
  location: ChuppahLocation,
): readonly RestrictedZone[] {
  // A pack with fewer than two pads offers no choice, and one with no deck has no
  // way to tell them apart. Both hand back the pack's OWN array — the toggle is
  // not offered on such a pack (Toolbar), and returning it unchanged means those
  // venues cannot be affected by this feature even in principle.
  if (zones.filter((z) => z.kind === 'chuppah').length < 2) return zones
  const deck = zones.find((z) => z.kind === 'kabalatPanim')
  if (!deck) return zones
  const wantDeck = location === 'reception'
  return Object.freeze(
    zones.filter((z) => z.kind !== 'chuppah' || isZoneInside(z, deck) === wantDeck),
  )
}

/**
 * THE list. Every rule, every drawing and every height in the app reads the zones
 * through this — see the consumer table in PLAN-03 §2.2. Half a rollout is the
 * documented failure mode here (collision.ts:577-585, actions.ts:368-372):
 * a rectangle that disappears from the drawing and stays alive in the rules.
 */
export function effectiveZones(scene: ZoneScene): readonly RestrictedZone[] {
  return zonesFor(scene.venue.venuePackId, chuppahLocationOf(scene))
}
