/**
 * The 3D viewer entry point (default export — meant to be React.lazy-loaded).
 * Owns the R3F Canvas, the lighting/venue/object graph, the camera rig, and a
 * DOM preset overlay. Falls back to a friendly card if WebGL is unavailable or
 * the GL context throws.
 */
import { Component, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import { Box, Eye, Grid2x2, RotateCcw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../state/store'
import { applyCameraPreset, type CameraPreset } from './cameraPresets'
import { CameraRig } from './CameraRig'
import { LightingRig } from './LightingRig'
import { ObjectGroup } from './ObjectGroup'
import { strings3d } from './strings3d'
import { VenueMesh } from './VenueMesh'

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    )
  } catch {
    return false
  }
}

function Fallback() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas p-6">
      <div className="max-w-sm rounded-xl border border-line bg-panel p-6 text-center shadow-sm">
        <h2 className="mb-2 text-[15px] font-semibold text-ink">{strings3d.fallback.title}</h2>
        <p className="text-[13px] leading-relaxed text-ink-soft">{strings3d.fallback.body}</p>
      </div>
    </div>
  )
}

class GLErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function Objects() {
  const order = useEditorStore(useShallow((s) => s.scene.objectOrder))
  return (
    <>
      {order.map((id) => (
        <ObjectGroup key={id} id={id} />
      ))}
    </>
  )
}

const PRESETS: { id: CameraPreset; label: string; Icon: typeof Box }[] = [
  { id: 'overview', label: strings3d.presets.overview, Icon: Box },
  { id: 'top', label: strings3d.presets.top, Icon: Grid2x2 },
  { id: 'eye', label: strings3d.presets.eye, Icon: Eye },
]

function PresetBar({ controlsRef }: { controlsRef: React.RefObject<CameraControlsImpl | null> }) {
  const [active, setActive] = useState<CameraPreset>('overview')

  const apply = (preset: CameraPreset) => {
    const c = controlsRef.current
    if (!c) return
    applyCameraPreset(c, useEditorStore.getState().scene.venue, preset, true)
    setActive(preset)
  }

  return (
    <div
      className="absolute top-3 z-10 flex items-center gap-1 rounded-full border border-line bg-panel/90 p-1 shadow-sm backdrop-blur"
      style={{ insetInlineEnd: '0.75rem' }}
    >
      {PRESETS.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            type="button"
            onClick={() => apply(id)}
            title={label}
            aria-pressed={isActive}
            className={
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors ' +
              (isActive
                ? 'bg-accent text-white'
                : 'text-ink-soft hover:bg-accent-tint hover:text-accent')
            }
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => apply('overview')}
        title={strings3d.presets.reset}
        aria-label={strings3d.presets.reset}
        className="ms-0.5 flex items-center rounded-full p-1.5 text-ink-soft hover:bg-accent-tint hover:text-accent"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  )
}

export default function Scene3D() {
  const webglOk = useMemo(detectWebGL, [])
  const controlsRef = useRef<CameraControlsImpl>(null)

  if (!webglOk) return <Fallback />

  return (
    <div className="relative h-full w-full">
      <GLErrorBoundary fallback={<Fallback />}>
        <Canvas
          frameloop="demand"
          shadows
          dpr={[1, 1.75]}
          gl={{ antialias: true }}
          camera={{ fov: 45, near: 0.1, far: 4000, position: [10, 16, 28] }}
        >
          <color attach="background" args={['#f6f5f2']} />
          <LightingRig />
          <VenueMesh />
          <Objects />
          <CameraRig controlsRef={controlsRef} />
        </Canvas>
      </GLErrorBoundary>
      <PresetBar controlsRef={controlsRef} />
    </div>
  )
}
