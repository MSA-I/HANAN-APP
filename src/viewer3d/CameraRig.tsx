/**
 * Orbit/dolly controls (camera-controls via drei), framed to the venue on
 * mount and clamped so the camera can't dip below the floor. Preset switching
 * is driven from the DOM overlay in Scene3D through the shared controls ref.
 */
import { useEffect, type RefObject } from 'react'
import type CameraControlsImpl from 'camera-controls'
import { CameraControls } from '@react-three/drei'
import { cmToM } from '../core/space'
import { useEditorStore } from '../state/store'
import { applyCameraPreset } from './cameraPresets'

export function CameraRig({ controlsRef }: { controlsRef: RefObject<CameraControlsImpl | null> }) {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const diag = Math.hypot(cmToM(width), cmToM(depth))

  // frame the venue once, when the controls first mount
  useEffect(() => {
    const c = controlsRef.current
    if (c) applyCameraPreset(c, useEditorStore.getState().scene.venue, 'overview', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 - 0.03}
      minDistance={0.8}
      maxDistance={diag * 3.5}
    />
  )
}
