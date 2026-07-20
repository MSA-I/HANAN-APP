/**
 * The sun, plus a little ground bounce. Most of the fill now comes from the
 * environment map in Scene3D, so these two sit deliberately low: at the old
 * 0.5/1.1 the same scene blew the marble floor out to flat white once the
 * environment was added and the roof stopped shadowing it. The directional key
 * casts the scene's shadows, with its shadow camera fitted to the venue bounds.
 * A drei ContactShadows pass adds soft grounding under the furniture.
 *
 * Shadow cost note: ContactShadows re-renders on every invalidated frame (i.e.
 * during a drag). Resolution is kept at 512 and `far` is clamped just above
 * furniture height so the pass stays cheap even with hundreds of chairs.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { ContactShadows } from '@react-three/drei'
import { cmToM } from '../core/space'
import { useEditorStore } from '../state/store'

export function LightingRig() {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)

  const W = cmToM(width)
  const D = cmToM(depth)
  const H = cmToM(wallHeight)
  const cx = W / 2
  const cz = D / 2
  const diag = Math.hypot(W, D)
  const span = Math.max(W, D) * 0.9

  const target = useMemo(() => new THREE.Object3D(), [])
  const lightRef = useRef<THREE.DirectionalLight>(null)
  useLayoutEffect(() => {
    if (lightRef.current) lightRef.current.target = target
  }, [target])

  return (
    <>
      <hemisphereLight args={['#ffffff', '#d8d2c8', 0.2]} />

      <primitive object={target} position={[cx, 0, cz]} />
      <directionalLight
        ref={lightRef}
        position={[cx - W * 0.35, H * 1.6 + diag * 0.5, cz - D * 0.2 - diag * 0.15]}
        intensity={0.9}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      >
        <orthographicCamera
          attach="shadow-camera"
          args={[-span, span, span, -span, 0.5, diag * 4 + H * 3]}
        />
      </directionalLight>

      <ContactShadows
        position={[cx, 0.012, cz]}
        scale={[W + 1, D + 1]}
        far={cmToM(220)}
        blur={2.4}
        opacity={0.35}
        resolution={512}
        color="#3a352f"
      />
    </>
  )
}
