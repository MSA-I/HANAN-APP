/**
 * Camera controls (camera-controls via drei), framed to the venue on mount.
 * Mouse follows Lumion exactly: left = select only, middle = pan, and right +
 * wheel are handled by FlyControls (free look / move along the view). The
 * polar range is open upward so the user can look at the ceiling; a floor
 * guard keeps the eye ≥ 0.3m instead of a polar clamp. Preset switching is
 * driven from the DOM overlay in Scene3D through the shared controls ref.
 */
import { useEffect, type RefObject } from 'react'
import CameraControlsImpl from 'camera-controls'
import { CameraControls } from '@react-three/drei'
import { Vector3 } from 'three'
import { cmToM } from '../core/space'
import { useEditorStore } from '../state/store'
import { applyCameraPreset } from './cameraPresets'

/** metres above the venue floor (y=0) the eye may never go below */
const MIN_CAMERA_Y = 0.3

// Lumion mouse model: LEFT only selects (R3F object events — no camera action),
// MIDDLE pans, RIGHT and WHEEL belong to FlyControls (free look / view-forward).
const MOUSE_BUTTONS = {
  left: CameraControlsImpl.ACTION.NONE,
  middle: CameraControlsImpl.ACTION.TRUCK,
  right: CameraControlsImpl.ACTION.NONE,
  wheel: CameraControlsImpl.ACTION.NONE,
}

const _guardPos = new Vector3()

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

  // floor guard: whatever moved the camera (orbit, dolly, fly, look), never
  // let the eye sink below the floor. elevate() re-fires 'update' once, then
  // the guard finds y ≥ MIN and stops — no loop.
  useEffect(() => {
    const c = controlsRef.current
    if (!c) return
    const guard = () => {
      c.getPosition(_guardPos, false)
      if (_guardPos.y < MIN_CAMERA_Y) void c.elevate(MIN_CAMERA_Y - _guardPos.y, false)
    }
    c.addEventListener('update', guard)
    return () => c.removeEventListener('update', guard)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      mouseButtons={MOUSE_BUTTONS}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI - 0.05}
      minDistance={0.8}
      maxDistance={diag * 3.5}
    />
  )
}
