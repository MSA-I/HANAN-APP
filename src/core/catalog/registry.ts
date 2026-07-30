import type { CatalogEntry, Category } from './types'
import { tableEntries } from './entries/tables'
import { bridalChairEntries, seatingEntries } from './entries/seating'
import { barEntries } from './entries/bars'
import { tableDecorEntries } from './entries/tableDecor'
import { tableDesignEntries } from './entries/tableDesigns'
import { ringCenterEntries } from './entries/ringCenter'
import { decorEntries } from './entries/decor'
import { hangingEntries } from './entries/hanging'
import { chuppahEntries } from './entries/chuppah'
import { chuppahDecorEntries } from './entries/chuppahDecor'

const all: CatalogEntry[] = [
  ...tableEntries,
  ...seatingEntries,
  ...bridalChairEntries,
  ...barEntries,
  ...tableDecorEntries,
  ...tableDesignEntries,
  ...ringCenterEntries,
  ...decorEntries,
  ...hangingEntries,
  ...chuppahEntries,
  ...chuppahDecorEntries,
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
  // a design is arranged on a top like the decor above it. Its sibling v9
  // category, 'ringCenter', was folded INTO 'tables' at v13 — the ⌀380's two
  // centre pieces now list under the table they belong to (catalog/types.ts)
  'tableDesigns',
  'lighting',
  'decor',
  'chuppah',
  // beside the canopy, so it follows it
  'chuppahDecor',
]
