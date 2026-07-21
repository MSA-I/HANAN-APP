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

/**
 * Do NOT reintroduce a "hide faces whose footprint matches a restricted zone"
 * filter here. It was tried, and it hid `Marble_01_1K1` — the pool's marble
 * surround, a RING with 24% fill whose outer boundary shares vertices with the
 * hole in the terrace slab. That deleted the 2 m walkway between the railing and
 * the coping and let the backdrop show through.
 *
 * The premise was wrong twice over: the shipped GLB has no material whose name
 * begins with `ZONE` (glb-prep strips them by name at prep time), and zone rects
 * come from `extract-zones.mjs` as the AABB of the marker — so matching a zone
 * rect to a real architectural face is structural, not a coincidence. If a marker
 * ever does survive, test SOLIDITY (triangle area ≥ ~95% of the bbox) instead: a
 * painted marker fills its rect, a surround ring fills a quarter of it.
 */
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
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      box.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
      mesh.receiveShadow = true
      mesh.castShadow = box.min.y < ceilingY
    })
  }, [scene, pack])

  return <primitive object={scene} position={pack.offset} />
}
