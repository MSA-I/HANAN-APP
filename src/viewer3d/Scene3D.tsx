/**
 * The 3D viewer entry point (default export — meant to be React.lazy-loaded).
 * Owns the R3F Canvas, the lighting/venue/object graph, the camera rig, and a
 * DOM preset overlay. Falls back to a friendly card if WebGL is unavailable or
 * the GL context throws.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, useTexture } from '@react-three/drei'
import type CameraControlsImpl from 'camera-controls'
import { EquirectangularReflectionMapping, SRGBColorSpace, type PerspectiveCamera } from 'three'
import { Box, Camera, Check, CopyPlus, Download, Eye, Grid2x2, RotateCcw, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getVenuePack } from '../core/venuePacks'
import { useOverlayStore } from '../editor2d/overlayStore'
import { clearSelection, duplicateObjects, removeObjects } from '../state/actions'
import { isEffectivelyLocked, lightingOf, visibleTopLevelIds } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { LIGHTING_MODES } from './lightingModes'
import { applyCameraPreset, applySealedCamera, type CameraPreset } from './cameraPresets'
import { capture3d, registerCapture3d } from './captureBus3d'
import { CameraRig } from './CameraRig'
import { FlyControls } from './FlyControls'
import { LightingRig } from './LightingRig'
import { ObjectGroup } from './ObjectGroup'
import { Placement3D } from './Placement3D'
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

/**
 * Image-based fill. Every material in the venue GLB is metalness 0.5, so with no
 * scene.environment they have nothing to reflect and render near-black — this is
 * what actually lifts the walls, floor and columns, more than any lamp does.
 *
 * The photo LIGHTS the scene but is never seen: `background` is deliberately not
 * set (user decision, 2026-07-21). It is an ordinary 3:2 landscape shot, and
 * wrapped around the horizon it read as a stretched smear behind the hall. The
 * backdrop is the flat canvas colour instead; only the reflections remain.
 *
 * drei's `<Environment files>` can't be used: it routes .webp to the gainmap
 * loader, which wants a gainmap-encoded image rather than a plain photo. Loading
 * the texture here and passing `map` takes the same path minus that loader —
 * three still builds the PMREM for scene.environment off the equirect itself.
 *
 * `environmentIntensity` is below 1 because the light thrown into the hall should
 * be gentler than the source image.
 */
function Backdrop() {
  const texture = useTexture('/env/backdrop.webp')
  const envIntensity = useEditorStore((s) => LIGHTING_MODES[lightingOf(s.scene).mode].envIntensity)
  texture.mapping = EquirectangularReflectionMapping
  texture.colorSpace = SRGBColorSpace
  return <Environment map={texture} environmentIntensity={envIntensity} />
}

/**
 * toneMappingExposure is a GL property, not a scene-graph prop — R3F won't
 * re-render on its own when it changes, so set it imperatively + invalidate.
 * The only real `frameloop="demand"` gotcha in the lighting path.
 */
function Exposure() {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const exposure = useEditorStore((s) => LIGHTING_MODES[lightingOf(s.scene).mode].exposure)
  useEffect(() => {
    gl.toneMappingExposure = exposure
    invalidate()
  }, [gl, exposure, invalidate])
  return null
}

function Objects() {
  const order = useEditorStore(useShallow((s) => visibleTopLevelIds(s.scene)))
  return (
    <>
      {order.map((id) => (
        <ObjectGroup key={id} id={id} />
      ))}
    </>
  )
}

function SelectionActions3D() {
  const placing = useOverlayStore((s) => s.placing)
  const state = useEditorStore(
    useShallow((s) => {
      const objects = s.selection.map((id) => s.scene.objects[id]).filter(Boolean)
      return {
        count: s.selection.length,
        canDelete: objects.some((obj) => !isEffectivelyLocked(s.scene, obj)),
        canDuplicate:
          objects.length === s.selection.length &&
          objects.length > 0 &&
          objects.every((obj) => !obj.parentId && !isEffectivelyLocked(s.scene, obj)),
      }
    }),
  )

  if (!state.count || placing) return null
  const button =
    'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-35'

  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-panel/92 p-1 shadow-lg backdrop-blur">
      <span className="px-2 text-[13px] font-semibold text-ink-soft" aria-live="polite">
        {state.count === 1 ? strings3d.selection.one : strings3d.selection.many(state.count)}
      </span>
      <button
        type="button"
        disabled={!state.canDuplicate}
        onClick={() => duplicateObjects(useEditorStore.getState().selection)}
        title={strings3d.selection.duplicate}
        aria-label={strings3d.selection.duplicate}
        className={`${button} text-ink-soft hover:bg-accent-tint hover:text-accent`}
      >
        <CopyPlus size={14} />
        <span>שכפול</span>
      </button>
      <button
        type="button"
        disabled={!state.canDelete}
        onClick={() => removeObjects(useEditorStore.getState().selection)}
        title={strings3d.selection.delete}
        aria-label={strings3d.selection.delete}
        className={`${button} text-danger hover:bg-danger/10`}
      >
        <Trash2 size={14} />
        <span>מחיקה</span>
      </button>
    </div>
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
  const [saved, setSaved] = useState(false)
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

  /** Name the file after the view it shows, so a folder of captures stays readable. */
  const captureName = () => {
    const label =
      PRESETS.find((p) => p.id === active)?.label ?? sealed.find((s) => s.id === active)?.label ?? 'מבט'
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
    return `${label}__${stamp}`
  }

  /**
   * Save the current angle. The dev server writes it into HANAN-APP-DOCS/צילומים
   * (tools/capture-plugin.ts); in a real build that endpoint doesn't exist, so we
   * fall back to a plain download rather than losing the frame.
   */
  const doCapture = () => {
    clearSelection() // no selection highlight in the frame
    requestAnimationFrame(async () => {
      const url = capture3d({ width: 1536, height: 1024 })
      if (!url) return
      const name = captureName()
      try {
        const res = await fetch('/__capture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dataUrl: url, name }),
        })
        if (!res.ok) throw new Error(String(res.status))
        setSaved(true)
        window.setTimeout(() => setSaved(false), 1500)
      } catch {
        const a = document.createElement('a')
        a.href = url
        a.download = `${name}.png`
        a.click()
      }
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
        title={strings3d.capture.title}
        aria-label={strings3d.capture.title}
        className={
          'ms-0.5 flex items-center rounded-full p-1.5 transition-colors ' +
          (saved ? 'text-accent' : 'text-ink-soft hover:bg-accent-tint hover:text-accent')
        }
      >
        {saved ? <Check size={14} /> : <Download size={14} />}
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
  // sunset's #f6f5f2 matches --color-canvas in index.css, so 2D and 3D share a backdrop
  const background = useEditorStore((s) => LIGHTING_MODES[lightingOf(s.scene).mode].background)

  if (!webglOk) return <Fallback />

  return (
    <div className="relative h-full w-full">
      <GLErrorBoundary fallback={<Fallback />}>
        <Canvas
          frameloop="demand"
          shadows
          dpr={[1, 1.75]}
          gl={{ antialias: true, toneMappingExposure: 0.9 }}
          camera={{ fov: 45, near: 0.1, far: 4000, position: [10, 16, 28] }}
          onPointerMissed={() => {
            if (!useOverlayStore.getState().placing) clearSelection()
          }}
        >
          <color attach="background" args={[background]} />
          <Suspense fallback={null}>
            <Backdrop />
          </Suspense>
          <Exposure />
          <LightingRig />
          <VenueMesh />
          <Objects />
          <Placement3D />
          <CameraRig controlsRef={controlsRef} />
          <FlyControls controlsRef={controlsRef} />
          <CaptureRegistrar />
        </Canvas>
      </GLErrorBoundary>
      <PresetBar controlsRef={controlsRef} />
      <SelectionActions3D />
      <FlyHint />
    </div>
  )
}

/** Small key-hint chip — flight is only active in full-3D mode. */
function FlyHint() {
  const is3d = useEditorStore((s) => s.mode === '3d')
  if (!is3d) return null
  return (
    <div
      className="pointer-events-none absolute bottom-3 z-10 rounded-full border border-line bg-panel/90 px-3 py-1 text-[11px] text-ink-soft shadow-sm backdrop-blur"
      style={{ insetInlineStart: '0.75rem' }}
    >
      {strings3d.fly.hint}
    </div>
  )
}
