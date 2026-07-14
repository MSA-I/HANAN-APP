/**
 * Bridges a plan-space Transform2D onto a three.js object, going ONLY through
 * core/space.planToThree so the coordinate convention lives in one place.
 */
import * as THREE from 'three'
import type { Transform2D } from '../core/model/types'
import { planToThree } from '../core/space'

/** Position + Y-rotation a three Object3D from a plan transform (hot path). */
export function applyPlanTransform(obj: THREE.Object3D, t: Transform2D): void {
  const { position, rotationY } = planToThree(t)
  obj.position.set(position[0], position[1], position[2])
  obj.rotation.set(0, rotationY, 0)
}

/** Same mapping baked into a Matrix4 — used for instanced chair matrices. */
export function planTransformMatrix(t: Transform2D, out = new THREE.Matrix4()): THREE.Matrix4 {
  const { position, rotationY } = planToThree(t)
  out.makeRotationY(rotationY)
  out.setPosition(position[0], position[1], position[2])
  return out
}
