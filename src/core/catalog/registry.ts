import type { CatalogEntry, Category } from './types'
import { tableEntries } from './entries/tables'
import { bridalChairEntries, seatingEntries } from './entries/seating'
import { barEntries } from './entries/bars'
import { tableDecorEntries } from './entries/tableDecor'
import { decorEntries } from './entries/decor'
import { hangingEntries } from './entries/hanging'
import { chuppahEntries } from './entries/chuppah'

const all: CatalogEntry[] = [
  ...tableEntries,
  ...seatingEntries,
  ...bridalChairEntries,
  ...barEntries,
  ...tableDecorEntries,
  ...decorEntries,
  ...hangingEntries,
  ...chuppahEntries,
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

/** library / layers order, top to bottom: floor furniture, then table, then room */
export const CATEGORY_ORDER: Category[] = [
  'tables',
  'seating',
  'bridalChair',
  'bars',
  'tableware',
  'tableDecor',
  'lighting',
  'decor',
  'chuppah',
]
