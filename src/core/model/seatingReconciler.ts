/**
 * Keeps a table's attached chairs consistent with its SeatingConfig.
 * Runs inside store actions on an Immer draft, so a seating change plus all
 * resulting chair mutations are a single state transition (one undo entry).
 *
 * Note: attached chairs live in scene.objects but NOT in scene.objectOrder —
 * objectOrder holds top-level objects only; children order by seatIndex.
 */
import { getCatalogEntry } from '../catalog/registry'
import { maxSeatsForEntry, seatsForEntry } from '../layout/seatLayout'
import { newId } from './factory'
import { childSortKey, type Id, type SceneObject, type SceneState } from './types'

export function attachedChairs(scene: SceneState, tableId: Id): SceneObject[] {
  return Object.values(scene.objects)
    .filter((o) => o.parentId === tableId && o.attachment?.kind === 'seat')
    .sort((a, b) => childSortKey(a) - childSortKey(b))
}

export function reconcileSeats(scene: SceneState, tableId: Id): void {
  const table = scene.objects[tableId]
  if (!table?.seating) return
  const seating = table.seating
  const entry = getCatalogEntry(table.catalogId)
  const chairEntry = getCatalogEntry(seating.chairCatalogId)

  const max = maxSeatsForEntry(entry, table.size, seating, chairEntry.defaultSize)
  const target = seating.enabled ? Math.max(0, Math.min(seating.count, max)) : 0
  seating.count = target

  const seats = seatsForEntry(entry, table.size, { ...seating, count: target }, chairEntry.defaultSize)
  const existing = attachedChairs(scene, tableId)

  // drop extras (highest seat index first)
  for (const extra of existing.slice(target)) {
    delete scene.objects[extra.id]
  }

  const kept = existing.slice(0, target)
  kept.forEach((chair, i) => {
    if (chair.attachment?.kind === 'seat') chair.attachment.seatIndex = i
    if (chair.catalogId !== seating.chairCatalogId) {
      chair.catalogId = seating.chairCatalogId
      chair.size = { ...chairEntry.defaultSize }
      chair.appearance = {}
    }
    if (chair.attachment?.kind === 'seat' && !chair.attachment.manual) chair.transform = seats[i]
  })

  // new chairs inherit the appearance of the last existing chair (recolored sets stay uniform)
  const templateAppearance = kept.length > 0 ? kept[kept.length - 1].appearance : {}
  for (let i = kept.length; i < target; i++) {
    const chair: SceneObject = {
      id: newId(),
      catalogId: seating.chairCatalogId,
      name: '',
      transform: seats[i],
      size: { ...chairEntry.defaultSize },
      parentId: tableId,
      attachment: { kind: 'seat', seatIndex: i, manual: false },
      appearance: JSON.parse(JSON.stringify(templateAppearance)),
      flags: { locked: false, visible: true },
      meta: {},
    }
    scene.objects[chair.id] = chair
  }
}
