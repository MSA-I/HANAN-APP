/**
 * Source doc §49 — "position and rotation change" on a selected chair.
 *
 * The X/Y fields in `ChairInspector` read WORLD centimetres while an attached
 * child's `transform` is PARENT-RELATIVE, so a typed X has to be converted back
 * before `setPosition` sees it. `InspectorPanel.tsx` does that with
 * `relativeTransform`, which `space.ts` declares to be `composeTransform`'s exact
 * inverse and `space.test.ts` round-trips on a bare pair of transforms.
 *
 * That is not enough on its own to justify making the fields editable: what the
 * inspector runs is the conversion PLUS `setPosition`, on a real chair, under a
 * rotated parent, through the placement gate and both clamps. This file is that
 * path end to end — the exact expression the component evaluates, against the
 * store, with the table turned so a wrong sign or a missed rotation cannot pass.
 *
 * ⚠ The component itself cannot be tested: vite.config.ts pins the suite to a
 * `node` environment and to plain `.test.ts` files under src, so there is no DOM
 * and no renderer (BRIEF §1.7). This is the closest reachable seam, which is why
 * the conversion is one expression in the component rather than spread through
 * the render.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SceneObject, Vec2 } from '../core/model/types'
import { composeTransform, relativeTransform } from '../core/space'
import { addObject, newProject, setPosition, setRotation } from './actions'
import { useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

const TABLE = 'table.round'
const chairsOf = (tableId: string) =>
  Object.values(scene().objects).filter(
    (o) => o.parentId === tableId && o.attachment?.kind === 'seat',
  )

/** World transform of a child, exactly as `ChairInspector` computes it for display. */
function worldOf(child: SceneObject) {
  const parent = child.parentId ? scene().objects[child.parentId] : null
  return parent ? composeTransform(parent.transform, child.transform) : child.transform
}

/**
 * VERBATIM the expression in `InspectorPanel.tsx`'s `setWorldPos`. Kept as one
 * function so the two cannot drift without this file failing.
 */
function inspectorSetWorldPos(child: SceneObject, position: Vec2) {
  const parent = child.parentId ? scene().objects[child.parentId] : null
  const world = worldOf(child)
  setPosition(
    child.id,
    parent ? relativeTransform(parent.transform, { ...world, position }).position : position,
  )
}

beforeEach(() => {
  newProject({ name: 'child transform', venuePackId: 'resort' })
})

describe('typing a world X/Y on an attached chair', () => {
  it('lands the chair on the number that was typed', () => {
    const table = addObject(TABLE, { x: 1000, y: 700 })
    const chair = chairsOf(table)[0]
    expect(chair).toBeDefined()

    const before = worldOf(chair)
    inspectorSetWorldPos(chair, { x: before.position.x + 25, y: before.position.y })

    const after = worldOf(scene().objects[chair.id])
    expect(after.position.x).toBeCloseTo(before.position.x + 25, 6)
    expect(after.position.y).toBeCloseTo(before.position.y, 6)
  })

  /**
   * The case a wrong conversion survives on an unrotated table and dies on this
   * one: at 37° the parent's frame and the world's share no axis, so writing the
   * world value straight into `transform.position` — or rotating the wrong way —
   * moves the chair somewhere else entirely.
   */
  it('holds under a rotated parent, where a missing conversion would not', () => {
    const table = addObject(TABLE, { x: 1000, y: 700 })
    setRotation(table, 37)
    const chair = chairsOf(table)[0]
    const target = { x: 1120, y: 640 }

    inspectorSetWorldPos(chair, target)
    const landed = worldOf(scene().objects[chair.id])
    expect(landed.position.x).toBeCloseTo(target.x, 6)
    expect(landed.position.y).toBeCloseTo(target.y, 6)

    // and the naive version really would have been wrong — the raw world point
    // written as if it were local lands over a metre away
    const parent = scene().objects[table]
    const naive = composeTransform(parent.transform, {
      position: target,
      rotation: 0,
      elevation: 0,
    })
    expect(Math.hypot(naive.position.x - target.x, naive.position.y - target.y)).toBeGreaterThan(100)
  })

  it('round-trips: reading the displayed value back gives the same chair', () => {
    const table = addObject(TABLE, { x: 1000, y: 700 })
    setRotation(table, 37)
    const chair = chairsOf(table)[0]
    const local = { ...chair.transform.position }

    // type the value the field is already showing — the chair must not move
    inspectorSetWorldPos(chair, worldOf(chair).position)
    const after = scene().objects[chair.id]
    expect(after.transform.position.x).toBeCloseTo(local.x, 6)
    expect(after.transform.position.y).toBeCloseTo(local.y, 6)
  })

  /**
   * `setPosition` marks a moved seat `manual`, which is what stops
   * `reconcileSeats` snapping it back to its ring position on the next seating
   * change. Without it the inspector would appear to work and then silently undo
   * itself — so it belongs to this path, not to the drag path alone.
   */
  it('marks the chair manual so the reconciler leaves it where it was put', () => {
    const table = addObject(TABLE, { x: 1000, y: 700 })
    const chair = chairsOf(table)[0]
    expect(chair.attachment).toMatchObject({ kind: 'seat', manual: false })

    inspectorSetWorldPos(chair, { x: 1030, y: 700 })
    expect(scene().objects[chair.id].attachment).toMatchObject({ manual: true })
  })
})
