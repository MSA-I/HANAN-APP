/**
 * IndexedDB-backed project repository (via `idb`). Two stores under one DB:
 * `projects` holds the ProjectFile envelope keyed by project id, `previews`
 * holds a rendered floor-plan PNG blob keyed by the same id. Reads pass through
 * `migrateAndValidate` so an older or hand-edited record is upgraded/validated
 * before it reaches the editor.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { migrateAndValidate } from '../core/migrations'
import type { ProjectFile, ProjectRepository, ProjectSummary } from './types'

const DB_NAME = 'hanan-app'
const DB_VERSION = 1

interface HananDB extends DBSchema {
  projects: { key: string; value: ProjectFile }
  previews: { key: string; value: Blob }
}

let dbPromise: Promise<IDBPDatabase<HananDB>> | null = null

function getDb(): Promise<IDBPDatabase<HananDB>> {
  if (!dbPromise) {
    dbPromise = openDB<HananDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects')
        if (!db.objectStoreNames.contains('previews')) db.createObjectStore('previews')
      },
    })
  }
  return dbPromise
}

export class IndexedDbRepository implements ProjectRepository {
  async list(): Promise<ProjectSummary[]> {
    const db = await getDb()
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
    const db = await getDb()
    const raw = await db.get('projects', id)
    if (!raw) return null
    return migrateAndValidate(raw)
  }

  async save(file: ProjectFile): Promise<void> {
    const db = await getDb()
    await db.put('projects', file, file.project.id)
  }

  async remove(id: string): Promise<void> {
    const db = await getDb()
    await db.delete('projects', id)
    await db.delete('previews', id)
  }

  async savePreview(id: string, png: Blob): Promise<void> {
    const db = await getDb()
    await db.put('previews', png, id)
  }

  async loadPreviewUrl(id: string): Promise<string | null> {
    const db = await getDb()
    const blob = await db.get('previews', id)
    return blob ? URL.createObjectURL(blob) : null
  }
}

export const indexedDbRepository = new IndexedDbRepository()
