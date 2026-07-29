/**
 * The 3D viewer entry point (default export — meant to be React.lazy-loaded).
 * Owns the R3F Canvas, the lighting/venue/object graph, the camera rig, and a
 * DOM preset overlay. Falls back to a friendly card if WebGL is unavailable or
 * the GL context throws.
 */
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Environment, useTexture } from '@react-three/drei'
import type CameraControlsImpl from 'camera-controls'
import { EquirectangularReflectionMapping, SRGBColorSpace, Vector3, type PerspectiveCamera } from 'three'
import { Box, Camera, Check, CopyPlus, Download, Eye, Grid2x2, Images, RotateCcw, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { composeExport, exportableAngles } from '../core/prompts/compose'
import { BACKGROUND_REF, CAPTURE_SIZE } from '../core/prompts/refs'
import { getVenuePack } from '../core/venuePacks'
import { useOverlayStore } from '../editor2d/overlayStore'
import { exportPromptPackage, type PromptExportOutcome, type PromptExportStatus } from '../persistence/export'
import { strings } from '../ui/strings'
import { clearSelection, duplicateObjects, removeObjects } from '../state/actions'
import { notify } from '../state/notice'
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

/**
 * Dev-only escape hatch for headless verification: the R3F store is not
 * reachable from page scripts (no `canvas.__r3f`), so perf measurement and
 * screenshot framing have no other way at the renderer or the camera.
 *
 * `scene` is here because the camera is NOT parented into the graph, so walking
 * up from it reaches nothing — and the shadow rig can only be asserted on by
 * finding the sun and reading its shadow frustum (Plans/R2/PERF-REPORT.md).
 */
function DevProbe({ controlsRef }: { controlsRef: RefObject<CameraControlsImpl | null> }) {
  const { gl, scene, camera, invalidate } = useThree()
  useEffect(() => {
    const w = window as typeof window & { __viewer3d?: unknown }
    w.__viewer3d = { gl, scene, camera, controlsRef, invalidate, info: () => gl.info }
    return () => {
      delete w.__viewer3d
    }
  }, [gl, scene, camera, controlsRef, invalidate])
  return null
}

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
  const [busy, setBusy] = useState(false)
  const venuePackId = useEditorStore((s) => s.scene.venue.venuePackId)
  const activeZone = useEditorStore((s) => s.activeZone)
  // A sealed angle belongs to the work zone named in `camera.zone`; no zone means
  // the hall. Switching to the reception deck swaps the five hall angles for its
  // own two rather than adding to them (source doc §42).
  const sealed = (getVenuePack(venuePackId)?.cameras ?? []).filter(
    (cam) => (cam.zone ?? 'hall') === activeZone,
  )

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

  // Switching work zone flies to that zone's first sealed angle — the reception
  // deck is 47m up and 14m east of the hall, so leaving the camera where it was
  // would show the user an empty hall and no sign anything happened (§41c).
  // Keyed on activeZone only: it must not re-fire when the pack or the list
  // identity changes, and it must not fight the user's own angle clicks.
  // The 3D pane is lazy — it usually mounts AFTER the zone was switched, so the
  // first run has to fly too. Only the ordinary hall mount is exempt, so opening
  // 3D normally still lands on the overview preset.
  // Tracks the zone we actually FLEW to, never the one we merely attempted:
  // StrictMode runs this effect twice and cancels the first attempt's frame, so a
  // ref updated up-front would mark the cancelled try as done and never retry.
  const flownZoneRef = useRef<string | null>(null)
  const mountedRef = useRef(false)
  useEffect(() => {
    const firstRun = !mountedRef.current
    mountedRef.current = true
    if (flownZoneRef.current === activeZone) return
    // opening 3D in the hall keeps the overview preset it has always opened on
    if (firstRun && activeZone === 'hall') {
      flownZoneRef.current = activeZone
      return
    }
    const cam = (getVenuePack(useEditorStore.getState().scene.venue.venuePackId)?.cameras ?? []).find(
      (s) => (s.zone ?? 'hall') === activeZone,
    )
    if (!cam) return
    // On that first run the Canvas is still suspending, so controlsRef is empty —
    // wait for the rig rather than silently skipping the fly. Then wait two more
    // frames: CameraRig frames the venue on ITS mount effect, and whichever of
    // the two runs last wins. Two frames is after it, and the fly is animated
    // anyway so the delay does not read.
    let frame = 0
    let tries = 0
    let settle = -1
    const tryApply = () => {
      const c = controlsRef.current
      if (!c && tries++ > 240) return
      if (c && settle < 0) settle = 2
      if (settle === 0) {
        applySealedCamera(c!, cam, true)
        setActive(cam.id)
        flownZoneRef.current = activeZone
        return
      }
      if (settle > 0) settle--
      frame = requestAnimationFrame(tryApply)
    }
    tryApply()
    return () => cancelAnimationFrame(frame)
  }, [activeZone, controlsRef])

  const chip = (isActive: boolean) =>
    'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] transition-colors ' +
    (isActive ? 'bg-accent text-white' : 'text-ink-soft hover:bg-accent-tint hover:text-accent')

  /** Name the file after the view it shows, so a folder of captures stays readable. */
  const captureName = () => {
    const label =
      PRESETS.find((p) => p.id === active)?.label ?? sealed.find((s) => s.id === active)?.label ?? 'מבט'
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replaceAll(':', '-')
    return `${label}__${stamp}`
  }

  /** One frame, taken after the selection outline has had a tick to disappear. */
  const grabFrame = () =>
    new Promise<string | null>((done) => {
      requestAnimationFrame(() => done(capture3d(CAPTURE_SIZE)))
    })

  /**
   * Block until the eye is actually AT `position`, or give up after ~1s.
   *
   * `setLookAt` only records where the camera should go; camera-controls moves
   * it in `update()`, which drei drives from useFrame — and the canvas is
   * `frameloop="demand"`, so there is no promise about when that runs. Capturing
   * on a timer instead of on arrival silently exports the PREVIOUS angle's
   * picture attached to this angle's prompt, which is the one failure this whole
   * feature cannot survive. Observed doing exactly that before this existed.
   */
  const settleAt = (position: [number, number, number]) =>
    new Promise<boolean>((done) => {
      const target = new Vector3(...position)
      const here = new Vector3()
      let frames = 0
      const tick = () => {
        const c = controlsRef.current
        if (!c) return done(false)
        c.update(1 / 60)
        c.getPosition(here, false)
        if (here.distanceTo(target) < 0.02) return done(true)
        if (++frames > 60) return done(false)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

  const flash = (ok: boolean) => {
    setSaved(ok)
    window.setTimeout(() => setSaved(false), 1500)
  }

  /**
   * The export's own account of itself, in the status bar.
   *
   * The checkmark used to flash whatever happened: a package that fell back to a
   * plain download, and one whose background reference was not on disk, both
   * looked like a clean save, because `exportPromptPackage`'s return value was
   * dropped (AGENT-BRIEF §8). A dropped reference is exactly the failure the
   * user cannot see in the output folder, so it has to be said out loud.
   *
   * The warnings themselves stay English — they are the same strings that go
   * into manifest.json and prompt.txt, and they name catalog ids and file paths.
   * Only the headline is a UI string, and only the ONE path a Hebrew reader can
   * be expected to recognise gets a Hebrew name.
   */
  const report = (outcomes: PromptExportOutcome[]) => {
    if (!outcomes.length) return
    const status: PromptExportStatus = outcomes.some((o) => o.status === 'failed')
      ? 'failed'
      : outcomes.some((o) => o.status === 'downloaded')
        ? 'downloaded'
        : 'saved'
    const head =
      status === 'saved'
        ? strings.promptExport.done
        : status === 'downloaded'
          ? strings.promptExport.downloaded
          : strings.promptExport.failed
    // deduped: exporting all seven angles repeats the same warning seven times
    const warnings = [...new Set(outcomes.flatMap((o) => o.warnings))].map((w) =>
      w.replaceAll(BACKGROUND_REF.path, strings.promptExport.backgroundRef),
    )
    // one notice, one line: the rest are in manifest.json, which is the record
    const shown = warnings.slice(0, 2)
    const rest = warnings.length - shown.length
    notify([head, ...shown].join(' · ') + (rest > 0 ? ` (+${rest})` : ''))
    flash(status !== 'failed')
  }

  /**
   * Save the current angle. A SEALED angle leaves as a full package — capture,
   * prompt and reference images (PLAN-08 §47) — because that is what an image
   * model needs; a free preset has no template to describe it, so it still
   * leaves as a bare frame.
   *
   * The dev server writes into HANAN-APP-DOCS/צילומים (tools/capture-plugin.ts);
   * in a real build that endpoint doesn't exist and exportPromptPackage falls
   * back to a download rather than losing the frame.
   */
  const doCapture = async () => {
    clearSelection() // no selection highlight in the frame
    const angle = sealed.find((s) => s.id === active)
    // the chips fly with an animated transition — capturing mid-flight would
    // export a frame from somewhere between two angles
    if (angle) await settleAt(angle.position)
    const url = await grabFrame()
    if (!url) return
    const { scene, projectName } = useEditorStore.getState()
    if (!angle) {
      // a free preset: no sealed camera, so no angle template and no frustum
      try {
        const res = await fetch('/__capture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dataUrl: url, name: captureName() }),
        })
        if (!res.ok) throw new Error(String(res.status))
        flash(true)
      } catch {
        const a = document.createElement('a')
        a.href = url
        a.download = `${captureName()}.png`
        a.click()
      }
      return
    }
    report([await exportPromptPackage(composeExport(scene, active), url, projectName)])
  }

  /**
   * §47's "export all seven angles": jump to each sealed angle in turn and export
   * it. Sequential on purpose — there is one renderer and one camera.
   *
   * Iterates the PACK's cameras, not `sealed`: the chip bar shows only the active
   * work zone's angles (§42), but an export of "all the angles" means all of
   * them, reception deck included, and driving the camera does not need the chip.
   */
  const doCaptureAll = async () => {
    const controls = controlsRef.current
    if (!controls || busy) return
    const { scene } = useEditorStore.getState()
    const angles = exportableAngles(scene)
    if (!angles.length) return
    setBusy(true)
    clearSelection()
    // reported once at the end rather than seven times: the notice is one slot
    // and the last message would be the only one anybody ever saw
    const outcomes: PromptExportOutcome[] = []
    try {
      for (const cam of angles) {
        applySealedCamera(controls, cam, false)
        setActive(cam.id)
        await settleAt(cam.position)
        const url = await grabFrame()
        if (!url) continue
        const state = useEditorStore.getState()
        outcomes.push(
          await exportPromptPackage(composeExport(state.scene, cam.id), url, state.projectName),
        )
      }
      report(outcomes)
    } finally {
      setBusy(false)
    }
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
        title={sealed.some((s) => s.id === active) ? strings.promptExport.one : strings3d.capture.title}
        aria-label={strings3d.capture.title}
        className={
          'ms-0.5 flex items-center rounded-full p-1.5 transition-colors ' +
          (saved ? 'text-accent' : 'text-ink-soft hover:bg-accent-tint hover:text-accent')
        }
      >
        {saved ? <Check size={14} /> : <Download size={14} />}
      </button>
      {sealed.length > 0 && (
        <button
          type="button"
          onClick={doCaptureAll}
          disabled={busy}
          title={busy ? strings.promptExport.allBusy : strings.promptExport.all}
          aria-label={strings.promptExport.all}
          className={
            'flex items-center rounded-full p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
            'text-ink-soft hover:bg-accent-tint hover:text-accent'
          }
        >
          <Images size={14} />
        </button>
      )}
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
          /* PCF, named explicitly. Do NOT simplify this back to a bare
             `shadows`, and do NOT "upgrade" it to shadows="soft" — both map to
             THREE.PCFSoftShadowMap, which three 0.182 no longer implements.
             Its shadowMapTypeDefines table holds PCF and VSM only and anything
             else falls through to SHADOWMAP_TYPE_BASIC, so the bare boolean was
             silently rendering BASIC: measured on the unmodified tree,
             gl.shadowMap.type read 2. Worse, WebGLShadowMap gives the depth
             texture NearestFilter with compareFunction null for every type
             EXCEPT PCFShadowMap, so it was one unfiltered, texel-quantised tap.
             That is the staircase in the user's photo.
             "percentage" is R3F's name for THREE.PCFShadowMap and is the only
             value that buys both the 5-sample Vogel disk and a bilinear
             hardware-compare sampler. It is also what makes LightingRig's
             SHADOW_RADIUS mean anything — the BASIC branch never reads it. */
          shadows="percentage"
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
          {import.meta.env.DEV && <DevProbe controlsRef={controlsRef} />}
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
      className="pointer-events-none absolute bottom-3 z-10 rounded-full border border-line bg-panel/90 px-3 py-1.5 text-[13px] text-ink-soft shadow-sm backdrop-blur"
      style={{ insetInlineStart: '0.75rem' }}
    >
      {strings3d.fly.hint}
    </div>
  )
}
