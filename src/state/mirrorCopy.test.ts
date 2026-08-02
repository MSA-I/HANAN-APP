/**
 * PLAN-07 §5 — COPY MIRROR, in the user's own words: "in the MIRROR option I want
 * to be able to do a COPY MIRROR of the same element too".
 *
 * The landing point is the part with a decision behind it, so it is what most of
 * these assert: reflected about the original's own right-hand edge in the
 * ORIGINAL's frame, with the table aisle added — never `duplicateObjects`' +50/+50,
 * which on a 477 cm table would put the reflection inside the original and re-open
 * the §4.3 gate hole on the day the feature lands.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { checkPlacement, clearanceOf, TABLE_CLEARANCE } from '../core/layout/collision'
import type { Id, SceneState } from '../core/model/types'
import { rotateVec } from '../core/space'
import { strings } from '../ui/strings'
import {
  addObject,
  mirrorCopyObjects,
  newProject,
  rotateObjectsBy,
  setLocked,
  undo,
} from './actions'
import { useNoticeStore } from './notice'
import { attachedChairs } from '../core/model/seatingReconciler'
import { useEditorStore } from './store'

const scene = (): SceneState => useEditorStore.getState().scene

/** The offset §5.2 defines, derived from the catalog rather than written down. */
const expectedOffset = (id: Id) => {
  const src = scene().objects[id]
  const entry = getCatalogEntry(src.catalogId)
  const outline = entry.footprint(src.size).outline
  const width = outline.kind === 'circle' ? outline.r * 2 : outline.w
  const aisle = clearanceOf(entry, outline)
  return rotateVec({ x: width + aisle, y: 0 }, src.transform.rotation)
}

const gate = (id: Id) => {
  const o = scene().objects[id]
  return checkPlacement(scene(), {
    catalogId: o.catalogId,
    transform: o.transform,
    size: o.size,
    excludeId: id,
    subtreeOf: id,
  })
}

beforeEach(() => {
  newProject({ name: 'mirrorCopy', venueWidth: 4000, venueDepth: 3000 })
  useNoticeStore.setState({ message: '' })
})

describe('mirrorCopyObjects (E2/§5)', () => {
  it('returns one new id, mirrored, and does not touch the original', () => {
    const id = addObject('table.serpentine', { x: 900, y: 1400 })
    const before = JSON.parse(JSON.stringify(scene().objects[id]))
    const ids = mirrorCopyObjects([id])
    expect(ids).toHaveLength(1)
    const copy = scene().objects[ids[0]]
    expect(copy.transform.mirrored).toBe(true)
    expect(copy.catalogId).toBe('table.serpentine')
    expect(scene().objects[id]).toEqual(before)
    // the chairs came along
    expect(attachedChairs(scene(), ids[0]).length).toBe(attachedChairs(scene(), id).length)
  })

  it('lands the copy at outline width + aisle along the local x-axis', () => {
    const id = addObject('table.round', { x: 900, y: 1400 })
    const d = expectedOffset(id)
    const [copyId] = mirrorCopyObjects([id])
    expect(scene().objects[copyId].transform.position).toEqual({ x: 900 + d.x, y: 1400 + d.y })
    // and the aisle really is the catalog's, not a number typed here
    expect(d.x).toBeCloseTo(
      getCatalogEntry('table.round').defaultSize.width + TABLE_CLEARANCE.circle,
      6,
    )
  })

  it('follows the LOCAL axis of a table turned 37°, not the world one', () => {
    const id = addObject('table.round', { x: 1500, y: 1500 })
    rotateObjectsBy([id], 37)
    expect(scene().objects[id].transform.rotation).toBeCloseTo(37, 6)
    const d = expectedOffset(id)
    expect(d.y).not.toBeCloseTo(0, 3) // it really is off the world x-axis
    const [copyId] = mirrorCopyObjects([id])
    const at = scene().objects[copyId].transform.position
    expect(at.x).toBeCloseTo(1500 + d.x, 6)
    expect(at.y).toBeCloseTo(1500 + d.y, 6)
    // the copy keeps the original's heading; only the reflection bit changed
    expect(scene().objects[copyId].transform.rotation).toBeCloseTo(37, 6)
  })

  /**
   * The assertion that carries E2's hard dependency on E1/§4.2: the landing search
   * asks `checkPlacement` about a MIRRORED candidate. Before the mirror fix that
   * answer was wrong by up to 2.87 m on this table, so the copy would land legal
   * on paper and overlapping on screen.
   */
  it('lands the copy LEGAL — which is only true because the rules read `mirrored`', () => {
    const id = addObject('table.serpentine', { x: 900, y: 1400 })
    const [copyId] = mirrorCopyObjects([id])
    expect(gate(copyId)).toEqual([])
    expect(gate(id)).toEqual([])
  })

  it('is exactly one undo entry', () => {
    const id = addObject('table.round', { x: 900, y: 1400 })
    const objectsBefore = Object.keys(scene().objects).length
    const orderBefore = [...scene().objectOrder]
    mirrorCopyObjects([id])
    expect(Object.keys(scene().objects).length).toBeGreaterThan(objectsBefore)
    undo()
    expect(Object.keys(scene().objects).length).toBe(objectsBefore)
    expect(scene().objectOrder).toEqual(orderBefore)
  })

  it('makes no second chuppah, and says why', () => {
    const id = addObject('chuppah.draped-white', { x: 1500, y: 1500 })
    expect(mirrorCopyObjects([id])).toEqual([])
    expect(
      Object.values(scene().objects).filter(
        (o) => getCatalogEntry(o.catalogId).unique === 'chuppah',
      ),
    ).toHaveLength(1)
    expect(useNoticeStore.getState().message).toBe(strings.status.uniqueNotCopied(1))
  })

  it('skips a child in the selection rather than refusing the gesture', () => {
    // the same rule `mirrorObjects` applies, and for the same reason: after a
    // drill-in the selection routinely holds a table and one of its chairs
    const id = addObject('table.round', { x: 900, y: 1400 })
    const chair = attachedChairs(scene(), id)[0]
    const ids = mirrorCopyObjects([chair.id, id])
    expect(ids).toHaveLength(1)
    expect(scene().objects[ids[0]].catalogId).toBe('table.round')
  })

  it('copies a LOCKED source, and the copy is not locked', () => {
    // `duplicateObjects`' rule, not `mirrorObjects`': nothing about the original
    // changes, so a lock has nothing to protect here
    const id = addObject('table.round', { x: 900, y: 1400 })
    setLocked([id], true)
    const [copyId] = mirrorCopyObjects([id])
    expect(copyId).toBeDefined()
    expect(scene().objects[id].flags.locked).toBe(true)
    expect(scene().objects[copyId].flags.locked).toBe(false)
  })

  it('un-mirrors a mirrored source — two reflections are none', () => {
    const id = addObject('table.serpentine', { x: 900, y: 1400 })
    useEditorStore.setState((s) => {
      s.scene.objects[id].transform.mirrored = true
      return s
    })
    const [copyId] = mirrorCopyObjects([id])
    // deleted, not set to false: an unmirrored object must serialise exactly as it
    // did before the flag existed
    expect('mirrored' in scene().objects[copyId].transform).toBe(false)
  })

  it('renumbers the copied table instead of sharing the original’s number', () => {
    const id = addObject('table.round', { x: 900, y: 1400 })
    const [copyId] = mirrorCopyObjects([id])
    expect(scene().objects[copyId].meta.number).toBe(2)
    expect(scene().objects[id].meta.number).toBe(1)
  })
})
