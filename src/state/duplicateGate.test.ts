/**
 * PLAN-07 §4.3 — copying must not switch the placement gate off.
 *
 * The user's own report was two complaints and one cause: "it will not let me put
 * the serpentine against a wall or a table beside it — **but when I duplicate a
 * table it does let me**". The second half is not a workaround, it is the bug.
 *
 * `ruled()` (actions.ts) deliberately exempts an object that is ALREADY illegal
 * where it stands, so a project saved before the rules existed stays editable
 * (handoff/03-collision-api.md §3.2). A duplicate landing at +50/+50 on a 477 cm
 * table overlaps its own original, which makes BOTH of them already-illegal — and
 * from that instant neither answers to any rule. Measured before this change: a
 * serpentine at x = 700 in a hall that runs 0…6051 could be dragged to x = −4300.
 *
 * Alt+drag is the same hole in one gesture and 100% reliably, because
 * `dragController` duplicates in EXACT overlap and then drags the original.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { getCatalogEntry } from '../core/catalog/registry'
import { checkPlacement } from '../core/layout/collision'
import type { Id, SceneState } from '../core/model/types'
import { strings } from '../ui/strings'
import {
  addObject,
  duplicateObjects,
  moveObjectsBy,
  newProject,
  pasteSubtrees,
  select,
  type Subtree,
} from './actions'
import { useNoticeStore } from './notice'
import { childrenOf } from './selectors'
import { useEditorStore } from './store'

const scene = (): SceneState => useEditorStore.getState().scene
const SERP = 'table.serpentine'

/** Exactly what `candidateFor` asks about an existing object where it stands. */
const gateIgnoring = (id: Id, ignore: Id[] = []) => {
  const o = scene().objects[id]
  return checkPlacement(scene(), {
    catalogId: o.catalogId,
    transform: o.transform,
    size: o.size,
    excludeId: [id, ...ignore],
    subtreeOf: id,
  })
}
const gate = (id: Id) => gateIgnoring(id)

const subtreeOf = (id: Id): Subtree => ({
  root: JSON.parse(JSON.stringify(scene().objects[id])),
  children: JSON.parse(JSON.stringify(childrenOf(scene(), id))),
})

const inVenue = (id: Id): boolean => {
  const { width, depth } = scene().venue.size
  const p = scene().objects[id].transform.position
  return p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= depth
}

beforeEach(() => {
  newProject({ name: 'gate', venuePackId: 'resort' })
  useNoticeStore.setState({ message: '' })
})

describe('duplication no longer disarms the gate (E1/§4.3)', () => {
  /**
   * ⚠ (700, 420) and not (700, 700), and the difference is worth a sentence: from
   * (700, 700) the +50/+50 ray runs straight into the pool and the apron around it,
   * so NO multiple of it is legal and the copy falls back to landing at +50/+50 —
   * the "never refuses" half of the contract, exercised on its own below. The bug
   * this test is about is the one that bit wherever there WAS room.
   */
  it('leaves the ORIGINAL legal after Ctrl+D — the test that failed before', () => {
    const id = addObject(SERP, { x: 700, y: 420 })
    expect(gate(id)).toEqual([])
    const [copy] = duplicateObjects([id])
    expect(copy).toBeDefined()
    expect(gate(id)).toEqual([])
    expect(gate(copy)).toEqual([])
  })

  it('walks the copy along the offset it was given, not past it onto another axis', () => {
    const id = addObject(SERP, { x: 700, y: 420 })
    const [copy] = duplicateObjects([id], { x: 60, y: 0 })
    const from = scene().objects[id].transform.position
    const at = scene().objects[copy].transform.position
    expect(at.y).toBe(from.y)
    expect(at.x).toBeGreaterThan(from.x)
    // a whole multiple of the offset it asked for
    expect((at.x - from.x) % 60).toBe(0)
  })

  it('keeps a group rigid — one step for the whole selection', () => {
    const a = addObject('table.round', { x: 700, y: 400 })
    const b = addObject('table.round', { x: 700, y: 1000 })
    const [ca, cb] = duplicateObjects([a, b])
    const da = {
      x: scene().objects[ca].transform.position.x - 700,
      y: scene().objects[ca].transform.position.y - 400,
    }
    const db = {
      x: scene().objects[cb].transform.position.x - 700,
      y: scene().objects[cb].transform.position.y - 1000,
    }
    expect(db).toEqual(da)
  })

  it('holds an Alt+drag original inside the venue (§4.3(2))', () => {
    // exactly what dragController does: copy in place, then drag the ORIGINAL,
    // handing it the copy's id as something the gate must not see
    const id = addObject(SERP, { x: 700, y: 700 })
    const copies = duplicateObjects([id], { x: 0, y: 0 })
    select([id])
    moveObjectsBy([id], { x: -5000, y: 0 }, copies)
    expect(inVenue(id)).toBe(true)
    // legal against everything EXCEPT its own copy, which is still parked at the
    // start point — overlapping it is what the gesture looks like by design
    expect(gateIgnoring(id, copies)).toEqual([])
  })

  it('and the copy is still standing exactly where the gesture began', () => {
    const id = addObject(SERP, { x: 700, y: 700 })
    const [copy] = duplicateObjects([id], { x: 0, y: 0 })
    expect(scene().objects[copy].transform.position).toEqual({ x: 700, y: 700 })
    moveObjectsBy([id], { x: -300, y: 0 }, [copy])
    expect(scene().objects[copy].transform.position).toEqual({ x: 700, y: 700 })
  })

  it('WITHOUT ignoreIds the same drag still escapes — the hole is real', () => {
    // the negative control: drop the third argument and the old behaviour returns,
    // which is what makes the assertion above meaningful rather than incidental
    const id = addObject(SERP, { x: 700, y: 700 })
    duplicateObjects([id], { x: 0, y: 0 })
    select([id])
    moveObjectsBy([id], { x: -5000, y: 0 })
    expect(inVenue(id)).toBe(false)
  })

  it('refuses a one-per-scene item and says so (§4.3(3))', () => {
    const id = addObject('chuppah.draped-white', { x: 1200, y: 700 })
    expect(getCatalogEntry('chuppah.draped-white').unique).toBeDefined()
    expect(duplicateObjects([id])).toEqual([])
    expect(
      Object.values(scene().objects).filter(
        (o) => getCatalogEntry(o.catalogId).unique === 'chuppah',
      ),
    ).toHaveLength(1)
    expect(useNoticeStore.getState().message).toBe(strings.status.uniqueNotCopied(1))
  })

  it('still creates the copy when nothing along the ray is legal', () => {
    // the "never refuses" half of the contract: the ray runs straight into the
    // north wall, so no multiple of it is legal, and the copy lands anyway
    const id = addObject(SERP, { x: 700, y: 700 })
    const [copy] = duplicateObjects([id], { x: 0, y: -100 })
    expect(copy).toBeDefined()
    expect(scene().objects[copy]).toBeDefined()
  })

  describe('paste follows the same two rules', () => {
    it('walks an unaimed paste clear of what it was copied from', () => {
      const id = addObject(SERP, { x: 700, y: 420 })
      const st = subtreeOf(id)
      const [pasted] = pasteSubtrees([st])
      expect(gate(id)).toEqual([])
      expect(gate(pasted)).toEqual([])
    })

    it('does NOT walk a paste the user aimed', () => {
      // he named the spot; sliding away from it is the app moving furniture behind
      // his back, which is the complaint source doc §57 records
      const id = addObject('table.round', { x: 700, y: 400 })
      const st = subtreeOf(id)
      const [pasted] = pasteSubtrees([st], { x: 700, y: 1200 })
      expect(scene().objects[pasted].transform.position).toEqual({ x: 700, y: 1200 })
    })

    it('drops a one-per-scene root', () => {
      const id = addObject('chuppah.draped-white', { x: 1200, y: 700 })
      const st = subtreeOf(id)
      expect(pasteSubtrees([st])).toEqual([])
      expect(useNoticeStore.getState().message).toBe(strings.status.uniqueNotCopied(1))
    })
  })
})
