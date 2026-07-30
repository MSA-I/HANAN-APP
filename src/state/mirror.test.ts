/**
 * Source doc round 4 item 4 — MIRROR.
 *
 * The user asked for a real reflection, not a half turn, and asked for the
 * children to come with it. Both halves are one bit on the parent
 * (`Transform2D.mirrored`) plus the composition rule in `core/space.ts`, so what
 * is worth pinning here is that the bit really does reach the CHILDREN — a
 * chair's world pose is the thing a mirror is judged by, and it is derived, never
 * stored.
 *
 * The other invariant: a mirror is a POSE, so it obeys the same gate a rotation
 * does. It can be refused, and a refusal must leave the scene untouched rather
 * than half-applied.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { addObject, mirrorObjects, newProject, setLocked, undo } from './actions'
import { attachedChairs } from '../core/model/seatingReconciler'
import { worldTransform } from './selectors'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene
const TABLE = 'table.round'
const AT = { x: 900, y: 700 }

/** Every chair's world pose, keyed by seat index so two runs can be compared. */
function chairPoses(tableId: string) {
  const s = scene()
  return attachedChairs(s, tableId)
    .map((c) => {
      const w = worldTransform(s, c.id)!
      const seat = c.attachment?.kind === 'seat' ? c.attachment.seatIndex : -1
      return { seat, x: w.position.x, y: w.position.y, rotation: w.rotation }
    })
    .sort((a, b) => a.seat - b.seat)
}

beforeEach(() => {
  newProject({ name: 'mirror', venuePackId: 'resort' })
})

describe('mirrorObjects', () => {
  it('adds the flag, and takes it away again — never writing `false`', () => {
    const id = addObject(TABLE, AT)!
    mirrorObjects([id])
    expect(scene().objects[id].transform.mirrored).toBe(true)

    mirrorObjects([id])
    // deleted, not false: an unmirrored object must serialise byte-for-byte as it
    // did before the flag existed, which is what makes this migration-free
    expect('mirrored' in scene().objects[id].transform).toBe(false)
  })

  it('reflects every chair about the table, and negates the way each one faces', () => {
    const id = addObject(TABLE, AT)!
    const before = chairPoses(id)
    expect(before.length).toBeGreaterThan(3)

    mirrorObjects([id])
    const after = chairPoses(id)

    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      // x is reflected about the TABLE's centre, y is untouched…
      expect(after[i].x).toBeCloseTo(2 * AT.x - before[i].x, 6)
      expect(after[i].y).toBeCloseTo(before[i].y, 6)
      // …and the heading is negated, which is what a reflection does to an angle
      const sum = (after[i].rotation + before[i].rotation) % 360
      expect(Math.min(sum, 360 - sum)).toBeCloseTo(0, 6)
    }
  })

  it('is its own inverse — twice restores every chair exactly', () => {
    const id = addObject(TABLE, AT)!
    const before = chairPoses(id)
    mirrorObjects([id])
    mirrorObjects([id])
    expect(chairPoses(id)).toEqual(before)
  })

  it('is ONE undo entry', () => {
    const id = addObject(TABLE, AT)!
    mirrorObjects([id])
    expect(scene().objects[id].transform.mirrored).toBe(true)
    undo()
    expect(scene().objects[id]?.transform.mirrored).toBeUndefined()
  })

  it('leaves a locked object alone', () => {
    const id = addObject(TABLE, AT)!
    setLocked([id], true)
    mirrorObjects([id])
    expect(scene().objects[id].transform.mirrored).toBeUndefined()
  })

  it('ignores a child id — a mirrored cover on an unmirrored table is not a thing', () => {
    const id = addObject(TABLE, AT)!
    const chair = attachedChairs(scene(), id)[0]
    expect(chair).toBeDefined()
    mirrorObjects([chair.id])
    expect(scene().objects[chair.id].transform.mirrored).toBeUndefined()
    expect(scene().objects[id].transform.mirrored).toBeUndefined()
  })

  it('does nothing at all when nothing is selected', () => {
    const before = JSON.stringify(scene().objects)
    mirrorObjects([])
    expect(JSON.stringify(scene().objects)).toBe(before)
  })
})
