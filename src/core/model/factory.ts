import { nanoid } from 'nanoid'
import { getCatalogEntry } from '../catalog/registry'
import { beamGrid, snapToBeam } from '../layout/beams'
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
  return {
    venue,
    objects: {},
    objectOrder: [],
    settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true, layers: {} },
  }
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
