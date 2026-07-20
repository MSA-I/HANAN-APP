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

/** Metres of slack when matching a face footprint to a zone rectangle. The zones
 *  were extracted FROM these faces, so a true match is exact — this only absorbs
 *  float noise and the cm rounding in venuePacks.ts. */
const ZONE_MATCH_TOLERANCE = 0.15

/**
 * A zero-thickness horizontal face whose footprint IS one of the pack's restricted
 * rectangles is a leftover ZONE_* marker, not architecture.
 *
 * glb-prep strips markers by MATERIAL NAME (`ZONE_*`), which misses the ones that
 * kept their original material — in the resort that left `Marble_01_1K1`, an 18-tri
 * white marble slab at y=0 spanning the pool rect exactly, i.e. a lid over the pool.
 * Matching on geometry catches those without hardcoding a material name, and it
 * survives a re-prep. Faces are compared in world space, where three-metres are
 * plan-cm/100 (the pack offset is what makes that true).
 */
function isZoneMarker(box: Box3, pack: VenuePack): boolean {
  if (box.max.y - box.min.y > 0.01) return false // real geometry has thickness
  const near = (a: number, b: number) => Math.abs(a - b) < ZONE_MATCH_TOLERANCE
  return (pack.restricted ?? []).some(
    (z) =>
      near(box.min.x, cmToM(z.x)) &&
      near(box.max.x, cmToM(z.x + z.width)) &&
      near(box.min.z, cmToM(z.y)) &&
      near(box.max.z, cmToM(z.y + z.depth)),
  )
}

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
      if (isZoneMarker(box, pack)) {
        mesh.visible = false
        return
      }
      mesh.receiveShadow = true
      mesh.castShadow = box.min.y < ceilingY
    })
  }, [scene, pack])

  return <primitive object={scene} position={pack.offset} />
}
