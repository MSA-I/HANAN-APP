/**
 * Persistence contracts. A `ProjectFile` is the on-disk / in-IndexedDB envelope
 * around a `Project`: it carries the storage schema version and a save
 * timestamp so migrations and "last saved" UI have something to read without
 * touching the project body.
 */
import type { Project } from '../core/model/types'

export interface ProjectFile {
  schemaVersion: number
  app: 'hanan-app'
  savedAt: string
  project: Project
}

/** Lightweight row for the dashboard grid — never loads the full scene. */
export interface ProjectSummary {
  id: string
  name: string
  eventDate?: string
  updatedAt: string
}

export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>
  load(id: string): Promise<ProjectFile | null>
  save(file: ProjectFile): Promise<void>
  remove(id: string): Promise<void>
  savePreview(id: string, png: Blob): Promise<void>
  loadPreviewUrl(id: string): Promise<string | null>
}
