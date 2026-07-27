import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { getVenuePack } from '../core/venuePacks'
import { applyPlanTransform } from './planTransform'

describe('zone surface elevation', () => {
  it('renders local 0.00 on the resort chuppah platform', () => {
    const zone = getVenuePack('resort')!.restricted!.find((item) => item.kind === 'chuppah')!
    const object = new THREE.Object3D()

    applyPlanTransform(object, { position: { x: 0, y: 0 }, rotation: 0, elevation: 0 }, zone.elevation)

    expect(object.position.y).toBe(0.5)
  })
})
