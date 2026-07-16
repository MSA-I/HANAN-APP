/**
 * Renders a venue pack's prepped GLB (Draco-compressed) at the offset that puts
 * its floor corner on plan origin. Suspends while loading; the caller provides a
 * fallback (the procedural room) for loading and error states.
 */
import { useLayoutEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import type { Object3D } from 'three'
import type { VenuePack } from '../core/venuePacks'

export function VenuePackModel({ pack }: { pack: VenuePack }) {
  const { scene } = useGLTF(pack.model, '/draco/')

  useLayoutEffect(() => {
    scene.traverse((o: Object3D) => {
      const mesh = o as Object3D & { isMesh?: boolean; castShadow?: boolean; receiveShadow?: boolean }
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
  }, [scene])

  return <primitive object={scene} position={pack.offset} />
}
