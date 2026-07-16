/**
 * The 3D viewer entry point (default export — meant to be React.lazy-loaded).
 * Owns the R3F Canvas, the lighting/venue/object graph, the camera rig, and a
 * DOM preset overlay. Falls back to a friendly card if WebGL is unavailable or
 * the GL context throws.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import type CameraControlsImpl from 'camera-controls'
import type { PerspectiveCamera } from 'three'
import { Box, Camera, Download, Eye, Grid2x2, RotateCcw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getVenuePack } from '../core/venuePacks'
import { clearSelection } from '../state/actions'
import { useEditorStore } from '../state/store'
import { applyCameraPreset, applySealedCamera, type CameraPreset } from './cameraPresets'
import { capture3d, registerCapture3d } from './captureBus3d'
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

/**
 * Registers a clean-capture function while mounted. Renders the current view at a
 * target pixel size (aspect adjusted), returns a PNG data URL, then restores the
 * on-screen size. Lives inside the Canvas so it can reach the renderer.
 */
function CaptureRegistrar() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    registerCapture3d(({ width, height }) => {
      const canvas = gl.domElement
      const cam = camera as PerspectiveCamera
      const cssW = canvas.clientWidth || width
      const cssH = canvas.clientHeight || height
      const origPR = gl.getPixelRatio()
      const origAspect = cam.aspect
      try {
        gl.setPixelRatio(1)
        gl.setSize(width, height, false)
        cam.aspect = width / height
        cam.updateProjectionMatrix()
        gl.render(scene, camera)
        return canvas.toDataURL('image/png')
      } finally {
        gl.setPixelRatio(origPR)
        gl.setSize(cssW, cssH, false)
        cam.aspect = origAspect
        cam.updateProjectionMatrix()
        gl.render(scene, camera)
      }
    })
    return () => registerCapture3d(null)
  }, [gl, scene, camera])
  return null
}

const PRESETS: { id: CameraPreset; label: string; Icon: typeof Box }[] = [
  { id: 'overview', label: strings3d.presets.overview, Icon: Box },
  { id: 'top', label: strings3d.presets.top, Icon: Grid2x2 },
  { id: 'eye', label: strings3d.presets.eye, Icon: Eye },
]

function PresetBar({ controlsRef }: { controlsRef: React.RefObject<CameraControlsImpl | null> }) {
  const [active, setActive] = useState<string>('overview')
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const sealed = getVenuePack(venuePackId)?.cameras ?? []

  const apply = (preset: CameraPreset) => {
    const c = controlsRef.current
    if (!c) return
    applyCameraPreset(c, useEditorStore.getState().scene.venue, preset, true)
    setActive(preset)
  }

  const applySealed = (id: string) => {
    const c = controlsRef.current
    const cam = sealed.find((s) => s.id === id)
    if (!c || !cam) return
    applySealedCamera(c, cam, true)
    setActive(id)
  }

  const chip = (isActive: boolean) =>
    'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors ' +
    (isActive ? 'bg-accent text-white' : 'text-ink-soft hover:bg-accent-tint hover:text-accent')

  const doCapture = () => {
    clearSelection() // no selection highlight in the frame
    requestAnimationFrame(() => {
      const url = capture3d({ width: 1536, height: 1024 })
      if (!url) return
      const a = document.createElement('a')
      a.href = url
      a.download = 'venue-capture.png'
      a.click()
    })
  }

  return (
    <div
      className="absolute top-3 z-10 flex items-center gap-1 rounded-full border border-line bg-panel/90 p-1 shadow-sm backdrop-blur"
      style={{ insetInlineEnd: '0.75rem' }}
    >
      {PRESETS.map(({ id, label, Icon }) => (
        <button key={id} type="button" onClick={() => apply(id)} title={label} aria-pressed={active === id} className={chip(active === id)}>
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
      {sealed.length > 0 && <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />}
      {sealed.map((cam) => (
        <button key={cam.id} type="button" onClick={() => applySealed(cam.id)} title={cam.label} aria-pressed={active === cam.id} className={chip(active === cam.id)}>
          <Camera size={14} />
          <span>{cam.label}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={doCapture}
        title="צלם פריים נקי (1536×1024)"
        aria-label="צלם פריים נקי"
        className="ms-0.5 flex items-center rounded-full p-1.5 text-ink-soft hover:bg-accent-tint hover:text-accent"
      >
        <Download size={14} />
      </button>
      <button
        type="button"
        onClick={() => apply('overview')}
        title={strings3d.presets.reset}
        aria-label={strings3d.presets.reset}
        className="flex items-center rounded-full p-1.5 text-ink-soft hover:bg-accent-tint hover:text-accent"
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
          <CaptureRegistrar />
        </Canvas>
      </GLErrorBoundary>
      <PresetBar controlsRef={controlsRef} />
    </div>
  )
}
