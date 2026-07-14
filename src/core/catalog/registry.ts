import type { CatalogEntry, Category } from './types'
import { tableEntries } from './entries/tables'
import { seatingEntries } from './entries/seating'
import { stagingEntries } from './entries/staging'
import { barEntries } from './entries/bars'
import { decorEntries } from './entries/decor'

const all: CatalogEntry[] = [
  ...tableEntries,
  ...seatingEntries,
  ...stagingEntries,
  ...barEntries,
  ...decorEntries,
]

const byId = new Map(all.map((e) => [e.id, e]))

export function getCatalogEntry(id: string): CatalogEntry {
  const entry = byId.get(id)
  if (!entry) throw new Error(`Unknown catalog entry: ${id}`)
  return entry
}

export function hasCatalogEntry(id: string): boolean {
  return byId.has(id)
}

export function listCatalog(): CatalogEntry[] {
  return all
}

export function listByCategory(category: Category): CatalogEntry[] {
  return all.filter((e) => e.category === category)
}

export const CATEGORY_ORDER: Category[] = ['tables', 'seating', 'staging', 'bars', 'decor', 'structure']
