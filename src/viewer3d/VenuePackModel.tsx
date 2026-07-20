/**
 * Renders a venue pack's prepped GLB (Draco-compressed) at the offset that puts
 * its floor corner on plan origin. Suspends while loading; the caller provides a
 * fallback (the procedural room) for loading and error states.
 */
import { useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { Box3, type Mesh, type Object3D } from 'three'
import { cmToM } from '../core/space'
import type { VenuePack } from '../core/venuePacks'

/**
 * Share of wallHeight above which geometry counts as ceiling and stops casting.
 * wallHeight is the plan/camera framing figure, not a measurement of the model:
 * in the resort pack (wallHeight 11.6m) the roof quads sit at 10.53m while the
 * next geometry down — pergola and rigging — tops out at 9.16m. 0.85 lands in
 * that gap with ~0.7m of clearance either side.
 */
const CEILING_FRACTION = 0.85

export function VenuePackModel({ pack }: { pack: VenuePack }) {
  const { scene } = useGLTF(pack.model, '/draco/')

  useLayoutEffect(() => {
    // The roof is a pair of full-span quads. They are alphaMode BLEND — a
    // translucent canopy — but three ignores blend alpha when filling the shadow
    // map, so as casters they occlude 100% and put the whole event floor in
    // shade. Everything keeps receiving; only the ceiling stops casting.
    const ceilingY = cmToM(pack.wallHeight) * CEILING_FRACTION - pack.offset[1]
    const box = new Box3()
    scene.updateMatrixWorld(true)
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.receiveShadow = true
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
      mesh.castShadow = box.min.y < ceilingY
    })
  }, [scene, pack])

  return <primitive object={scene} position={pack.offset} />
}
