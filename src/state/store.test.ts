import { beforeEach, describe, expect, it } from 'vitest'
import { attachedChairs } from '../core/model/seatingReconciler'
import {
  addObject,
  beginGesture,
  detachChair,
  duplicateObjects,
  endGesture,
  moveObjectsBy,
  newProject,
  redo,
  removeObjects,
  setSeatCount,
  setSize,
  undo,
} from './actions'
import { projectFromState, temporalStore, useEditorStore } from './store'

const scene = () => useEditorStore.getState().scene

beforeEach(() => {
  newProject({ name: 'test', venueWidth: 2400, venueDepth: 1600 })
})

describe('object lifecycle + undo', () => {
  it('adds a round table with its default chairs, undo removes everything', () => {
    addObject('table.round', { x: 500, y: 500 })
    expect(scene().objectOrder).toHaveLength(1)
    expect(Object.keys(scene().objects)).toHaveLength(1 + 10)

    undo()
    expect(scene().objectOrder).toHaveLength(0)
    expect(Object.keys(scene().objects)).toHaveLength(0)

    redo()
    expect(Object.keys(scene().objects)).toHaveLength(11)
  })

  it('deleting a table cascades to attached chairs in one undo step', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    removeObjects([id])
    expect(Object.keys(scene().objects)).toHaveLength(0)
    undo()
    expect(Object.keys(scene().objects)).toHaveLength(11)
  })

  it('duplicate deep-copies the table with its chairs and offsets it', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    const [copyId] = duplicateObjects([id])
    expect(copyId).toBeDefined()
    expect(scene().objects[copyId].transform.position).toEqual({ x: 550, y: 550 })
    expect(attachedChairs(scene(), copyId)).toHaveLength(10)
    expect(scene().objects[copyId].meta.number).toBe(2)
  })
})

describe('gestures', () => {
  it('a multi-step drag is exactly one undo entry', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    beginGesture()
    for (let i = 0; i < 20; i++) moveObjectsBy([id], { x: 10, y: 0 })
    endGesture()
    expect(scene().objects[id].transform.position.x).toBe(700)

    undo()
    expect(scene().objects[id].transform.position.x).toBe(500)
    // one more undo removes the add itself
    undo()
    expect(scene().objects[id]).toBeUndefined()
  })

  it('a no-op gesture records nothing', () => {
    addObject('table.round', { x: 500, y: 500 })
    const before = temporalStore.getState().pastStates.length
    beginGesture()
    endGesture()
    expect(temporalStore.getState().pastStates.length).toBe(before)
  })
})

describe('seating reconciliation', () => {
  it('seat count changes create/remove chairs', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    setSeatCount(id, 12)
    expect(attachedChairs(scene(), id)).toHaveLength(12)
    setSeatCount(id, 6)
    expect(attachedChairs(scene(), id)).toHaveLength(6)
  })

  it('resizing a table re-flows chairs outward', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    const rBefore = Math.hypot(
      attachedChairs(scene(), id)[0].transform.position.x,
      attachedChairs(scene(), id)[0].transform.position.y,
    )
    setSize(id, { width: 240 })
    const rAfter = Math.hypot(
      attachedChairs(scene(), id)[0].transform.position.x,
      attachedChairs(scene(), id)[0].transform.position.y,
    )
    expect(rAfter - rBefore).toBeCloseTo(30) // radius grew by half the diameter change
  })

  it('a manually nudged chair is left alone by the reconciler', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    const chair = attachedChairs(scene(), id)[0]
    moveObjectsBy([chair.id], { x: 30, y: 0 })
    const nudged = { ...scene().objects[chair.id].transform.position }
    setSeatCount(id, 11)
    expect(scene().objects[chair.id].transform.position).toEqual(nudged)
    expect(scene().objects[chair.id].attachment?.manual).toBe(true)
  })

  it('detaching a chair bakes world position and shrinks the seat count', () => {
    const id = addObject('table.round', { x: 500, y: 500 })
    const chair = attachedChairs(scene(), id)[0]
    const localX = chair.transform.position.x
    detachChair(chair.id)
    const detached = scene().objects[chair.id]
    expect(detached.parentId).toBeNull()
    expect(detached.attachment).toBeUndefined()
    expect(detached.transform.position.x).toBeCloseTo(500 + localX)
    expect(scene().objects[id].seating?.count).toBe(9)
    expect(attachedChairs(scene(), id)).toHaveLength(9)
    expect(scene().objectOrder).toContain(chair.id)
  })

  it('seat count clamps to physical capacity', () => {
    const id = addObject('table.round', { x: 0, y: 0 })
    setSeatCount(id, 99)
    expect(scene().objects[id].seating?.count).toBe(13)
    expect(attachedChairs(scene(), id)).toHaveLength(13)
  })
})

describe('serialization', () => {
  it('project state survives a JSON round-trip', () => {
    addObject('table.round', { x: 500, y: 500 })
    addObject('stage.platform', { x: 1200, y: 200 })
    const project = projectFromState(useEditorStore.getState())
    const revived = JSON.parse(JSON.stringify(project))
    expect(revived.scene).toEqual(scene())
  })
})
