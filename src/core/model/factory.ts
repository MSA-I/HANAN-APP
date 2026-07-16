import { nanoid } from 'nanoid'
import { getCatalogEntry } from '../catalog/registry'
import { getVenuePack } from '../venuePacks'
import type { Id, Project, SceneObject, SceneState, Vec2 } from './types'
import { SCHEMA_VERSION } from './types'

export function newId(): Id {
  return nanoid(10)
}

export function createDefaultScene(
  venueWidth = 2400,
  venueDepth = 1600,
  venuePackId?: string | null,
): SceneState {
  const pack = getVenuePack(venuePackId)
  const venue = pack
    ? {
        size: { ...pack.size },
        wallHeight: pack.wallHeight,
        floor: { color: '#efebe4' },
        elements: [] as never[],
        venuePackId: pack.id,
      }
    : {
        size: { width: venueWidth, depth: venueDepth },
        wallHeight: 350,
        floor: { color: '#efebe4' },
        elements: [] as never[],
      }
  return {
    venue,
    objects: {},
    objectOrder: [],
    settings: { gridSize: 10, snapEnabled: true, showGrid: true, showLabels: true },
  }
}

export interface NewProjectOptions {
  name: string
  eventName?: string
  eventDate?: string
  venueWidth?: number
  venueDepth?: number
  venuePackId?: string | null
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
    scene: createDefaultScene(opts.venueWidth, opts.venueDepth, opts.venuePackId),
  }
}

export function createObject(catalogId: string, position: Vec2): SceneObject {
  const entry = getCatalogEntry(catalogId)
  return {
    id: newId(),
    catalogId,
    name: '',
    transform: { position, rotation: 0, elevation: 0 },
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
