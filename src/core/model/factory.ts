import { nanoid } from 'nanoid'
import { getCatalogEntry, hasCatalogEntry } from '../catalog/registry'
import { beamGrid, snapToBeam } from '../layout/beams'
import { VENUE_FIXTURES } from '../venueFixtures'
import { getVenuePack } from '../venuePacks'
import type { Id, Project, SceneObject, SceneState, Vec2, Venue } from './types'
import { SCHEMA_VERSION } from './types'

/** Ceiling height of a procedural room — pack halls carry their own. */
export const DEFAULT_WALL_HEIGHT = 350

export function newId(): Id {
  return nanoid(10)
}

export function createDefaultScene(
  venueWidth = 2400,
  venueDepth = 1600,
  venuePackId?: string | null,
  floorColor = '#efebe4',
): SceneState {
  const pack = getVenuePack(venuePackId)
  const venue = pack
    ? {
        // pack halls are fixed: the GLB floor is baked, so the color option does not apply
        size: { ...pack.size },
        wallHeight: pack.wallHeight,
        floor: { color: '#efebe4' },
        elements: [] as never[],
        venuePackId: pack.id,
      }
    : {
        size: { width: venueWidth, depth: venueDepth },
        wallHeight: DEFAULT_WALL_HEIGHT,
        floor: { color: floorColor },
        elements: [] as never[],
      }
  const objects: Record<Id, SceneObject> = {}
  const objectOrder: Id[] = []
  for (const fixture of venueFixtures(venue.venuePackId)) {
    objects[fixture.id] = fixture
    // `objectOrder` is the TOP-LEVEL z-order and nothing else (model/types.ts):
    // a baked chair or centrepiece renders inside its parent's group, and listing
    // it here would draw it a second time at parent-relative coordinates.
    if (!fixture.parentId) objectOrder.push(fixture.id)
  }
  return {
    venue,
    objects,
    objectOrder,
    settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true, layers: {} },
  }
}

/**
 * The baked fixtures of a venue, cloned and re-frozen (source doc §16). A stale
 * catalogId is dropped rather than thrown on: a bake written before a catalog
 * change must not make every NEW project unopenable.
 *
 * The bake carries a TREE, not a list — a baked table brings its chairs and its
 * centrepiece — so `parentId`, `attachment` and `seating` are seeded exactly as
 * written. Flattening them (which is what this function used to do, with a blunt
 * `parentId: null`) would read each child's parent-RELATIVE transform as a hall
 * coordinate and stack every chair at the origin.
 *
 * Only ROOTS are frozen. `frozen` implies `isEffectivelyLocked`
 * (state/selectors.ts:73), and an effectively-locked object cannot be picked in
 * the 2D editor, so freezing chairs and table decor would ship the user a table
 * they can never dress. The hall's own fittings stay immovable and undeletable;
 * what stands on them stays editable — which is also why children are seeded
 * `locked: false`, since `locked` reaches `isEffectivelyLocked` just the same.
 *
 * `registry` is injectable for the same reason `runMigrations` takes one — the
 * shipped table is empty until the user bakes, so a test needs its own.
 */
export function venueFixtures(
  venuePackId?: string | null,
  registry: Record<string, SceneObject[]> = VENUE_FIXTURES,
): SceneObject[] {
  const baked = venuePackId ? registry[venuePackId] : undefined
  if (!baked) return []
  // One forward pass: bake-plugin writes every root ahead of its children, so a
  // parent that survived is already in `kept` by the time its child is read. A
  // child whose root was dropped (retired catalogId) goes with it rather than
  // being seeded as an orphan holding a local offset.
  const kept = new Set<Id>()
  const seeded: SceneObject[] = []
  for (const object of baked) {
    if (!hasCatalogEntry(object.catalogId)) continue
    if (object.parentId && !kept.has(object.parentId)) continue
    kept.add(object.id)
    seeded.push({
      ...structuredClone(object),
      flags: object.parentId
        ? { locked: false, visible: true }
        : { locked: true, visible: true, frozen: true },
    })
  }
  return seeded
}

export interface NewProjectOptions {
  name: string
  eventName?: string
  eventDate?: string
  venueWidth?: number
  venueDepth?: number
  venuePackId?: string | null
  /** procedural rooms only — pack halls have a baked GLB floor */
  floorColor?: string
}

export function createProject(opts: NewProjectOptions): Project {
  const now = new Date().toISOString()
  return {
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    name: opts.name,
    eventName: opts.eventName,
    eventDate: opts.eventDate,
    createdAt: now,
    updatedAt: now,
    scene: createDefaultScene(opts.venueWidth, opts.venueDepth, opts.venuePackId, opts.floorColor),
  }
}

/**
 * `venue` is only consulted for placement:'ceiling' entries, which hang from
 * the pack's `hangHeight` (lighting-truss level) — or `wallHeight` where no
 * pack/truss exists — instead of standing at 0, and which SNAP to a crossing of
 * the ceiling beam grid: nothing hangs in mid-air between beams (source doc §12).
 * Core must stay store-free, so the caller passes the venue in. Omitting it
 * assumes a procedural room, which is right for every venue except a pack hall.
 */
export function createObject(
  catalogId: string,
  position: Vec2,
  // `size` only feeds the beam-grid fallback, so it stays optional: a caller that
  // omits it still gets the pack's real grid, just no synthetic one
  venue?: Pick<Venue, 'wallHeight' | 'venuePackId'> & Partial<Pick<Venue, 'size'>>,
): SceneObject {
  const entry = getCatalogEntry(catalogId)
  const ceiling = entry.placement === 'ceiling'
  const pack = getVenuePack(venue?.venuePackId)
  // top of the object meets the hang anchor; the seeded drop is the entry height
  //
  // ⚠ The 0 is not a stand-in for "nobody taught this the reception deck is at
  // +4.70". `transform.elevation` is LOCAL to the ground under the object, and the
  // ground is derived where the object is DRAWN — `groundHeightAt` in
  // core/layout/groundHeight.ts — never stored; planTransform.ts adds the two.
  // Seeding the deck height here would draw a chair up there at 9.40 m, and would
  // make every project already saved with a 0 on the deck wrong, which is a
  // migration. A chuppah has worked this way since round 1: it stores 0 and is
  // drawn at +0.50.
  const elevation = ceiling
    ? (pack?.hangHeight ?? venue?.wallHeight ?? DEFAULT_WALL_HEIGHT) - entry.defaultSize.height
    : 0
  const anchored =
    ceiling && venue?.size
      ? snapToBeam(position, beamGrid(pack, venue.size))
      : position
  return {
    id: newId(),
    catalogId,
    name: '',
    transform: { position: { ...anchored }, rotation: entry.defaultRotation ?? 0, elevation },
    size: { ...entry.defaultSize },
    parentId: null,
    appearance: {},
    seating: entry.seating
      ? {
          enabled: true,
          chairCatalogId: entry.seating.defaultChair,
          count: entry.seating.defaultCount,
          gap: entry.seating.defaultGap,
          offset: entry.seating.defaultOffset,
          startAngle: 0,
        }
      : undefined,
    flags: { locked: false, visible: true },
    meta: {},
  }
}
