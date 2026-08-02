/**
 * `selectionEditing` — the one pure pass the multi-selection inspector reads.
 *
 * The panel is JSX and `vite.config.ts` fixes `environment: 'node'`, so not one
 * line of it can be covered here. That is exactly why every question with a right
 * and a wrong answer was pushed into this function: what the panel is left doing
 * is drawing the numbers it is handed. If a section addresses the wrong subset,
 * shows an agreement that is not there, or hides a conflict, it fails HERE.
 *
 * The catalog is read rather than remembered — slot names and chair ids have moved
 * before, and a frozen literal would keep the file green while it stopped testing.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { editableSlotsOf } from '../core/catalog/types'
import { FABRIC_TEXTURE_IDS } from '../core/catalog/textures'
import type { Id } from '../core/model/types'
import {
  addObject,
  newProject,
  setAppearance,
  setLayerLocked,
  setLocked,
  setRotation,
  setSeatingConfig,
  setSlotTexture,
} from './actions'
import { selectionEditing } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const edit = (ids: Id[]) => selectionEditing(scene(), ids)

const TABLE = 'table.round'
const BIG = 'table.round-large'
const PLANT = 'plant.potted-2'
/** a second entry with a restyleable slot of ITS OWN name — 'fabric', not 'cloth' */
const DIVIDER = 'divider.screen'
const CLOTH = editableSlotsOf(getCatalogEntry(TABLE))[0].slot
const CHAIR = 'chair.gold-white'

/** A baked venue fixture, exactly as `createDefaultScene` seeds one. */
function freeze(id: Id): void {
  useEditorStore.setState((state) => {
    state.scene.objects[id].flags = { locked: true, visible: true, frozen: true }
  })
}

const chairOf = (tableId: Id): Id => {
  const chair = Object.values(scene().objects).find(
    (o) => o.parentId === tableId && o.attachment?.kind === 'seat',
  )
  if (!chair) throw new Error(`no chair attached to ${tableId}`)
  return chair.id
}

let a: Id
let b: Id
let plant: Id

beforeEach(() => {
  newProject({ name: 'selection', venueWidth: 4000, venueDepth: 4000 })
  a = addObject(TABLE, { x: 600, y: 600 })
  b = addObject(TABLE, { x: 1600, y: 600 })
  plant = addObject(PLANT, { x: 300, y: 2400 })
})

describe('scope', () => {
  it('drops ids whose object is already gone — a delete outlives the selection a render', () => {
    expect(edit([a, 'ghost']).ids).toEqual([a])
  })

  it('on a MIXED selection the table scope holds only the tables', () => {
    const e = edit([a, b, plant, chairOf(a)])
    expect(e.tableIds).toEqual([a, b])
    expect(e.ids).toHaveLength(4)
  })

  it('an attached chair is never a table, whatever it carries', () => {
    expect(edit([chairOf(a)]).tableIds).toEqual([])
  })

  it('counts the locked without hiding them, and offers to open only what can open', () => {
    setLocked([a], true)
    freeze(b)
    const e = edit([a, b, plant])
    expect(e.ids).toHaveLength(3)
    expect(e.editableIds).toEqual([plant])
    expect(e.lockedCount).toBe(2)
    // frozen is the lock with no button — the bake's whole point
    expect(e.unlockableIds).toEqual([a])
    expect(e.anyLocked).toBe(true)
  })

  it('a locked LAYER locks its members too, and no per-object button can open it', () => {
    setLayerLocked(getCatalogEntry(TABLE).category, true)
    const e = edit([a, b])
    expect(e.editableIds).toEqual([])
    expect(e.lockedCount).toBe(2)
    expect(e.unlockableIds).toEqual([])
    expect(e.editableTableIds).toEqual([])
    expect(e.tableIds).toEqual([a, b]) // still tables — the section renders, disabled
  })
})

describe('capabilities', () => {
  it('rotate and delete follow the lock; duplicate deliberately does not', () => {
    setLocked([a], true)
    const locked = edit([a])
    expect(locked.canRotate).toBe(false)
    expect(locked.canDelete).toBe(false)
    expect(locked.canMirror).toBe(false)
    // `duplicateObjects`' own rule: the copy is a new, unlocked object
    expect(locked.canDuplicate).toBe(true)
  })

  it('a selection of children alone can be turned but not duplicated', () => {
    const chair = chairOf(a)
    const e = edit([chair])
    expect(e.canRotate).toBe(true) // `canRotateObject` has no !parentId clause
    expect(e.canDuplicate).toBe(false)
    expect(e.canMirror).toBe(false)
  })

  it('a frozen fixture cannot be locked or unlocked', () => {
    freeze(a)
    expect(edit([a]).canLock).toBe(false)
    expect(edit([a, b]).canLock).toBe(true)
  })
})

describe('sharedRotation', () => {
  it('is the angle when they agree and null when they do not', () => {
    expect(edit([a, b]).sharedRotation).toBe(0)
    setRotation(b, 45)
    expect(edit([a, b]).sharedRotation).toBeNull()
    setRotation(a, 45)
    expect(edit([a, b]).sharedRotation).toBe(45)
  })

  it('is computed over the objects the field would WRITE to, not the whole selection', () => {
    setRotation(a, 45)
    setRotation(b, 45)
    const locked = addObject(TABLE, { x: 2600, y: 600 })
    setLocked([locked], true)
    // the locked table stands at 0° and the field will never touch it, so it must
    // not turn two agreeing tables into a conflict
    expect(edit([a, b, locked]).sharedRotation).toBe(45)
  })

  it('survives the float a drag leaves behind', () => {
    setRotation(a, 44.9999)
    setRotation(b, 45.0001)
    expect(edit([a, b]).sharedRotation).toBe(45)
  })

  it('is null when there is nothing rotatable at all', () => {
    setLocked([a], true)
    expect(edit([a]).sharedRotation).toBeNull()
  })
})

describe('sharedChairCatalogId', () => {
  it('is the model when the tables agree and null when they do not', () => {
    expect(edit([a, b]).sharedChairCatalogId).toBe(scene().objects[a].seating!.chairCatalogId)
    setSeatingConfig(b, { chairCatalogId: CHAIR })
    expect(edit([a, b]).sharedChairCatalogId).toBeNull()
  })

  it('ignores everything that is not a table', () => {
    expect(edit([plant]).sharedChairCatalogId).toBeNull()
  })
})

describe('slots', () => {
  it('are the UNION across entries, each row carrying its own members', () => {
    const divider = addObject(DIVIDER, { x: 300, y: 3000 })
    const rows = edit([a, b, divider, plant]).slots
    const byName = new Map(rows.map((r) => [r.slot, r]))
    expect(byName.get(CLOTH)!.ids).toEqual([a, b])
    const fabric = editableSlotsOf(getCatalogEntry(DIVIDER))[0].slot
    expect(byName.get(fabric)!.ids).toEqual([divider])
    // the plant restyles nothing, so it appears in no row — and the intersection
    // of this selection is empty, which is the case the union exists for
    expect(rows.every((r) => !r.ids.includes(plant))).toBe(true)
  })

  it('offers the texture picker when the slot declares it', () => {
    expect(edit([a]).slots[0].texture).toBe(editableSlotsOf(getCatalogEntry(TABLE))[0].texture === true)
  })

  it('a row never holds a locked member, because the write would skip it anyway', () => {
    setLocked([a], true)
    expect(edit([a, b]).slots[0].ids).toEqual([b])
  })

  it('a single id gives exactly the slots the single-item inspector shows', () => {
    const one = edit([a]).slots.map((r) => r.slot)
    expect(one).toEqual(editableSlotsOf(getCatalogEntry(TABLE)).map((s) => s.slot))
  })
})

describe('shared colour and texture — the two nulls that mean different things', () => {
  it('colour: the catalogue default while untouched, then null once one differs', () => {
    const row = () => edit([a, b]).slots[0]
    expect(row().sharedColor).toBe(getCatalogEntry(TABLE).materialSlots[0].defaultColor)
    setAppearance([a], CLOTH, '#c2060d')
    expect(row().sharedColor).toBeNull()
    setAppearance([b], CLOTH, '#c2060d')
    expect(row().sharedColor).toBe('#c2060d')
  })

  /**
   * ⚠ THE THREE TEXTURE STATES, and why `mixedTexture` is a separate flag:
   * "nobody chose" and "everyone chose none" both read as `null`, and so does
   * "they disagree". Only the flag tells the third from the first two — and the
   * picker marks its "none" tile off exactly that.
   */
  it('texture: agreeing on none is NOT a conflict, and a conflict is not none', () => {
    const row = () => edit([a, b]).slots[0]
    expect(row().sharedTextureId).toBeNull()
    expect(row().mixedTexture).toBe(false)

    setSlotTexture([a], CLOTH, FABRIC_TEXTURE_IDS[0])
    expect(row().mixedTexture).toBe(true)
    expect(row().sharedTextureId).toBeNull()

    setSlotTexture([b], CLOTH, FABRIC_TEXTURE_IDS[0])
    expect(row().mixedTexture).toBe(false)
    expect(row().sharedTextureId).toBe(FABRIC_TEXTURE_IDS[0])

    setSlotTexture([b], CLOTH, null)
    expect(row().mixedTexture).toBe(true)
  })

  it('tables of different sizes still share one cloth row', () => {
    const big = addObject(BIG, { x: 2600, y: 2600 })
    expect(edit([a, big]).slots[0].ids).toEqual([a, big])
  })
})

describe('an empty or impossible selection', () => {
  it('answers everything with nothing rather than throwing', () => {
    const e = edit([])
    expect(e.ids).toEqual([])
    expect(e.slots).toEqual([])
    expect(e.sharedRotation).toBeNull()
    expect(e.canDelete).toBe(false)
    expect(e.canDuplicate).toBe(false)
  })

  it('an object whose catalog entry has been retired is counted but restyles nothing', () => {
    useEditorStore.setState((state) => {
      state.scene.objects[plant].catalogId = 'plant.retired-in-v14'
    })
    const e = edit([a, plant])
    expect(e.ids).toHaveLength(2)
    expect(e.slots).toHaveLength(1) // `getCatalogEntry` THROWS on an unknown id
  })
})
