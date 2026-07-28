/**
 * IndexedDB-backed project repository (via `idb`). Three stores under one DB:
 * `projects` holds the ProjectFile envelope keyed by project id, `previews`
 * holds its floor-plan PNG, and `layouts` holds reusable saved selections.
 * Project reads pass through `migrateAndValidate` so an older or hand-edited
 * record is upgraded/validated before it reaches the editor.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { migrateAndValidate } from '../core/migrations'
import {
  migrateSavedLayout,
  sameVenueSignature,
  type SavedLayout,
  type VenueSignature,
} from '../core/savedLayouts'
import type { ProjectFile, ProjectRepository, ProjectSummary } from './types'

const DB_NAME = 'hanan-app'
const DB_VERSION = 2

/**
 * Layout writes happen in one component (the save dialog) and are read in
 * another (the picker), so the picker needs to know the store changed. A
 * revision counter + subscription is the whole mechanism — see PresetsSection.
 */
let layoutsRevisionCounter = 0
const layoutListeners = new Set<() => void>()

export function subscribeLayouts(listener: () => void): () => void {
  layoutListeners.add(listener)
  return () => layoutListeners.delete(listener)
}

export function layoutsRevision(): number {
  return layoutsRevisionCounter
}

function bumpLayouts(): void {
  layoutsRevisionCounter++
  for (const listener of layoutListeners) listener()
}

interface HananDB extends DBSchema {
  projects: { key: string; value: ProjectFile }
  previews: { key: string; value: Blob }
  layouts: { key: string; value: SavedLayout }
}

export class IndexedDbRepository implements ProjectRepository {
  private dbPromise: Promise<IDBPDatabase<HananDB>> | null = null

  constructor(private readonly dbName = DB_NAME) {}

  private getDb(): Promise<IDBPDatabase<HananDB>> {
    if (!this.dbPromise) {
      this.dbPromise = openDB<HananDB>(this.dbName, DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects')
          if (!db.objectStoreNames.contains('previews')) db.createObjectStore('previews')
          if (!db.objectStoreNames.contains('layouts')) db.createObjectStore('layouts')
        },
      })
    }
    return this.dbPromise
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await this.getDb()
    const files = await db.getAll('projects')
    return files
      .map((f) => ({
        id: f.project.id,
        name: f.project.name,
        eventDate: f.project.eventDate,
        updatedAt: f.project.updatedAt,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async load(id: string): Promise<ProjectFile | null> {
    const db = await this.getDb()
    const raw = await db.get('projects', id)
    if (!raw) return null
    return migrateAndValidate(raw)
  }

  async save(file: ProjectFile): Promise<void> {
    const db = await this.getDb()
    await db.put('projects', file, file.project.id)
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDb()
    await db.delete('projects', id)
    await db.delete('previews', id)
  }

  async savePreview(id: string, png: Blob): Promise<void> {
    const db = await this.getDb()
    await db.put('previews', png, id)
  }

  async loadPreviewUrl(id: string): Promise<string | null> {
    const db = await this.getDb()
    const blob = await db.get('previews', id)
    return blob ? URL.createObjectURL(blob) : null
  }

  /**
   * Unlike `load`, this never went through a migration — a layout written by an
   * older build reached the picker as-is. It does now: every record is upgraded
   * on read, and an unreadable one is dropped instead of crashing the panel.
   */
  private async allLayouts(): Promise<SavedLayout[]> {
    const db = await this.getDb()
    const raw = await db.getAll('layouts')
    return raw
      .map((layout) => migrateSavedLayout(layout))
      .filter((layout): layout is SavedLayout => !!layout)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  /** Hall/lighting layouts are venue-shaped, so only matching venues see them. */
  async listLayouts(venue: VenueSignature): Promise<SavedLayout[]> {
    return (await this.allLayouts()).filter(
      (layout) => layout.kind !== 'tableDesign' && sameVenueSignature(layout.venue, venue),
    )
  }

  /** Table designs are venue-independent — a dressed table travels between halls. */
  async listTableDesigns(): Promise<SavedLayout[]> {
    return (await this.allLayouts()).filter((layout) => layout.kind === 'tableDesign')
  }

  /** Also the overwrite path: `put` on an existing id replaces that record. */
  async saveLayout(layout: SavedLayout): Promise<void> {
    const db = await this.getDb()
    await db.put('layouts', layout, layout.id)
    bumpLayouts()
  }

  async renameLayout(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const db = await this.getDb()
    const existing = migrateSavedLayout(await db.get('layouts', id))
    if (!existing) return
    await db.put('layouts', { ...existing, name: trimmed }, id)
    bumpLayouts()
  }

  async removeLayout(id: string): Promise<void> {
    const db = await this.getDb()
    await db.delete('layouts', id)
    bumpLayouts()
  }
}

export const indexedDbRepository = new IndexedDbRepository()
