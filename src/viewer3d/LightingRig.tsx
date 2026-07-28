/**
 * The sun, plus a little ground bounce. Most of the fill now comes from the
 * environment map in Scene3D, so these two sit deliberately low: at the old
 * 0.5/1.1 the same scene blew the marble floor out to flat white once the
 * environment was added and the roof stopped shadowing it. The directional key
 * casts the scene's shadows, with its shadow camera fitted to the PLACED
 * OBJECTS rather than to the venue bounds (see shadowFit.ts for why).
 * A drei ContactShadows pass adds soft grounding under the furniture.
 *
 * Shadow cost note: ContactShadows re-renders on every invalidated frame (i.e.
 * during a drag), and `far` is clamped just above furniture height so the pass
 * stays cheap even with hundreds of chairs. Resolution went 512 → 1024 in R2:
 * at 512 its map covered the 61 x 26 m hall at 12 cm a texel, which was a
 * bigger source of blocky floor shadows than the sun's map. Doubling it cost
 * nothing measurable (Plans/R2/PERF-REPORT.md) — this scene is triangle-bound,
 * not fill-bound.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import { cmToM } from '../core/space'
import { lightingOf } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { LIGHTING_MODES } from './lightingModes'
import { clampBounds, contentBounds, fitShadowCamera, type Bounds3 } from './shadowFit'

/**
 * 4096 costs four times the GPU memory of 2048 (~67 MB for the depth target)
 * and was measured to cost no frame time here, because the bottleneck is
 * triangles, not shadow fill. Together with the fitted box it takes a
 * wall-to-wall furnished resort from 5.3 cm per texel to 1.3 — a 4 cm chair leg
 * goes from smaller than one texel to three.
 *
 * ponytail: one fixed size for every machine. The honest version reads the
 * renderer's limits, or drops to 2048 while a drag is in flight.
 */
const SHADOW_MAP_SIZE = 4096

/** Metres of slack around the fitted content, so a shadow never ends at an edge. */
const SHADOW_MARGIN_M = 3

/**
 * Metres — the smallest half-extent the fitted box may collapse to. A nearly
 * empty hall still wants the venue's own structure to cast over a useful area,
 * so the box never goes below a 24 m square even for a single chair.
 */
const SHADOW_MIN_HALF_M = 12

/**
 * Depth bias, in normalised depth units of the fitted box — for an orthographic
 * shadow camera that scale is linear, so the world offset is bias x (far−near).
 * The old -0.0004 was tuned against a 297 m range and worked out to ~12 cm of
 * depth offset; the fitted box measures 43 m on the resort, where the same
 * number would over-bias and detach shadows from their casters
 * (peter-panning). -0.00012 x 43 m ≈ 5 mm. normalBias is in world metres and is
 * held near one texel of the fitted box (1.3 cm at 4096).
 */
const SHADOW_BIAS = -0.00012
const SHADOW_NORMAL_BIAS = 0.012

export function LightingRig() {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)
  const lighting = useEditorStore((s) => lightingOf(s.scene))
  const mode = LIGHTING_MODES[lighting.mode]
  const invalidate = useThree((s) => s.invalidate)

  const W = cmToM(width)
  const D = cmToM(depth)
  const H = cmToM(wallHeight)
  const cx = W / 2
  const cz = D / 2
  const diag = Math.hypot(W, D)

  // Sun stands on a sphere around the venue centre. Azimuth 0 = plan north
  // (-z), clockwise from above; sunset's angles decompose the pre-v5 fixed
  // vector, so the default render matches the old hardcoded position exactly.
  const azRad = THREE.MathUtils.degToRad(lighting.sunAzimuth)
  const elRad = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(lighting.sunElevation, 5, 90))
  const sunX = cx - diag * Math.cos(elRad) * Math.sin(azRad)
  const sunY = diag * Math.sin(elRad)
  const sunZ = cz - diag * Math.cos(elRad) * Math.cos(azRad)

  const target = useMemo(() => new THREE.Object3D(), [])
  const lightRef = useRef<THREE.DirectionalLight>(null)
  useLayoutEffect(() => {
    if (lightRef.current) lightRef.current.target = target
  }, [target])

  /**
   * Re-fit the shadow box to the scene, imperatively.
   *
   * This is deliberately a store SUBSCRIPTION and not a selector: the box has to
   * follow an object while it is being dragged (a caster that leaves the box has
   * its shadow cut off mid-gesture), and a drag writes a transform on every
   * pointer move. Re-rendering the whole rig at that rate would cost more than
   * the shadow pass it is trying to improve, so nothing here goes through React.
   *
   * `updateProjectionMatrix` is mandatory: three's DirectionalLightShadow
   * repositions and re-aims the shadow camera every frame but never rebuilds its
   * projection, so changed extents are otherwise ignored. And with
   * `frameloop="demand"` the new box only reaches the screen after invalidate().
   */
  useEffect(() => {
    const venueBounds: Bounds3 = { min: [0, 0, 0], max: [W, H, D] }
    // Slack around the venue: objects legally sit on zone platforms and their
    // tops rise above wallHeight, and the clamp is only here to stop malformed
    // data from blowing the box back up to the whole desert.
    const limit: Bounds3 = {
      min: [-SHADOW_MARGIN_M, -SHADOW_MARGIN_M, -SHADOW_MARGIN_M],
      max: [W + SHADOW_MARGIN_M, H + SHADOW_MARGIN_M, D + SHADOW_MARGIN_M],
    }

    const refit = () => {
      const light = lightRef.current
      if (!light) return
      const found = contentBounds(useEditorStore.getState().scene)
      const content = found ? clampBounds(found, limit) : venueBounds
      const box = fitShadowCamera([sunX, sunY, sunZ], [cx, 0, cz], content, venueBounds, {
        margin: SHADOW_MARGIN_M,
        minHalfExtent: SHADOW_MIN_HALF_M,
      })
      const cam = light.shadow.camera
      cam.left = box.left
      cam.right = box.right
      cam.top = box.top
      cam.bottom = box.bottom
      cam.near = box.near
      cam.far = box.far
      cam.updateProjectionMatrix()
      invalidate()
    }

    refit()
    return useEditorStore.subscribe((s) => s.scene.objects, refit)
  }, [W, D, H, cx, cz, sunX, sunY, sunZ, invalidate])

  return (
    <>
      <hemisphereLight args={[mode.hemisphere.sky, mode.hemisphere.ground, mode.hemisphere.intensity]} />

      <primitive object={target} position={[cx, 0, cz]} />
      {/* No <orthographicCamera attach="shadow-camera"> here on purpose: the
          extents are driven imperatively above, and a JSX child would let R3F
          reconcile stale props back over them. The light's own default shadow
          camera is the one being configured. */}
      <directionalLight
        ref={lightRef}
        position={[sunX, sunY, sunZ]}
        color={mode.sun.color}
        intensity={lighting.sunIntensity}
        castShadow
        shadow-mapSize-width={SHADOW_MAP_SIZE}
        shadow-mapSize-height={SHADOW_MAP_SIZE}
        shadow-bias={SHADOW_BIAS}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />

      <ContactShadows
        position={[cx, 0.012, cz]}
        scale={[W + 1, D + 1]}
        far={cmToM(220)}
        blur={2.4}
        opacity={0.35}
        resolution={1024}
        color="#3a352f"
      />
    </>
  )
}
