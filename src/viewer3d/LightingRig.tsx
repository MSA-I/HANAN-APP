/**
 * The sun, plus a little ground bounce. Most of the fill now comes from the
 * environment map in Scene3D, so these two sit deliberately low: at the old
 * 0.5/1.1 the same scene blew the marble floor out to flat white once the
 * environment was added and the roof stopped shadowing it. The directional key
 * casts the scene's shadows, with its shadow camera fitted to the venue unioned
 * with the placed objects (see shadowFit.ts for why it is no longer the objects
 * alone). A drei ContactShadows pass adds soft grounding under the furniture.
 *
 * Shadow cost note: ContactShadows re-renders on every invalidated frame (i.e.
 * during a drag), and `far` is clamped just above furniture height so the pass
 * stays cheap even with hundreds of chairs. Its resolution went 512 → 1024 in
 * R2 and the note here used to claim that fixed the blocky floor shadows. It
 * did not, and it could not have: `blur` is measured in UV, not in texels, so
 * raising the resolution leaves every tap the same WORLD distance from the last
 * and merely resolves the ghosts more crisply. The arithmetic and the rule that
 * replaced it are on the ContactShadows props at the bottom of this file.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { ContactShadows } from '@react-three/drei'
import type { ShadowSharpness } from '../core/model/types'
import { cmToM } from '../core/space'
import { lightingOf } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { LIGHTING_MODES } from './lightingModes'
import { fitShadowCamera, shadowContent, type Bounds3 } from './shadowFit'

/**
 * Shadow-map edge per `settings.lighting.shadowSharpness`. Square depth target,
 * so every step is 4x the GPU memory: ~17 MB, ~67 MB, ~268 MB. None of them was
 * measured to cost frame time here — the bottleneck is triangles, not shadow
 * fill — but 8192 is a real allocation and is clamped to the GPU's limit below.
 *
 * `medium` is 4096 ON PURPOSE. That is exactly the fixed SHADOW_MAP_SIZE every
 * project rendered before this setting existed, and `shadowSharpness` is
 * optional, so a file saved without one opens looking identical.
 *
 * ponytail: still one size for the whole session. The honest version also drops
 * a step while a drag is in flight.
 */
// Not exported: nothing outside needs it, and a non-component export here makes
// React Fast Refresh give up on this file and full-reload the 3D scene on edit.
const SHADOW_MAP_SIZES: Record<ShadowSharpness, number> = {
  soft: 2048,
  medium: 4096,
  sharp: 8192,
}

/** Metres of slack around the fitted content, so a shadow never ends at an edge. */
const SHADOW_MARGIN_M = 3

/**
 * Metres — the smallest half-extent the fitted box may collapse to. A nearly
 * empty hall still wants the venue's own structure to cast over a useful area,
 * so the box never goes below a 24 m square even for a single chair.
 */
const SHADOW_MIN_HALF_M = 12

/**
 * PCF disk radius, in TEXELS of the shadow map — three's shader computes
 * `radius = shadowRadius * (1 / mapSize)`.
 *
 * This number is DEAD CODE unless Scene3D asks for `shadows="percentage"`. The
 * bare boolean lands on BASIC, whose shader branch never reads it, and BASIC is
 * what the app was actually rendering — read that comment first, because the
 * filter, not this radius, is what the user photographed.
 *
 * With PCF genuinely live, three 0.182 takes 5 samples on a Vogel disk rotated
 * per pixel by interleaved gradient noise, each one a hardware 4-tap bilinear
 * compare. `LightShadow.radius` defaults to 1, which packs all five into a
 * single texel — already far better than BASIC, since the bilinear compare
 * alone turns the hard step into a ~1 texel ramp, but the disk contributes
 * nothing. At 3 the same five samples spread over three texels and the
 * per-pixel rotation finally has something to dither, so the softness costs no
 * extra samples.
 *
 * 3 rather than 1 because the complaint is about the FAR edges of a 60 m hall,
 * where a 1.66 cm ramp is sub-pixel on screen and still reads as an aliased
 * edge, while 5 cm of penumbra reads as a soft one. Much past 3 and the dither
 * starts showing as grain — 5 samples is all there is.
 *
 * Because the unit is texels, a bigger map is automatically sharper: the
 * penumbra stays 3 texels wide, and a texel of the fitted box measures 3.32 cm
 * at 2048, 1.66 at 4096 and 0.83 at 8192 on the resort. That is exactly what a
 * "shadow sharpness" control ought to mean.
 *
 * ⚠ DEAD while `settings.lighting.shadowsEnabled` is false (PLAN-05 C2): with no
 * light casting, three's shadow pass gets an empty caster list and returns
 * before any of this is read. Same for SHADOW_BIAS and SHADOW_NORMAL_BIAS_TEXELS
 * below. Nothing here needs a guard — they simply stop being consulted.
 */
const SHADOW_RADIUS = 3

/**
 * Depth bias, in normalised depth units of the fitted box — for an orthographic
 * shadow camera that scale is linear, so the world offset is bias x (far−near).
 * The old -0.0004 was tuned against a 297 m range and worked out to ~12 cm of
 * depth offset; the fitted box measures 43 m on the resort, where the same
 * number would over-bias and detach shadows from their casters
 * (peter-panning). -0.00012 x 43 m ≈ 5 mm.
 */
const SHADOW_BIAS = -0.00012

/**
 * normalBias, counted in TEXELS of the fitted box rather than in metres, and
 * therefore applied in the refit below instead of as a JSX prop.
 *
 * It used to be a flat 0.012 m, which was one texel of the box as it stood when
 * it was tuned. Both halves of that number moved this round: the box now always
 * contains the venue, so a texel went 1.3 → 1.66 cm at 4096, and the kernel went
 * from the ±½ texel of quantisation error an unfiltered BASIC tap has to a disk
 * reaching SHADOW_RADIUS texels, so the depth error the bias has to cover grew
 * roughly sixfold. A metre constant also cannot be right at three map sizes at
 * once — it would over-bias `sharp` and leave `soft` in acne.
 *
 * A receiver plane at incidence angle a needs `b ≥ reach · sin a / cos² a`. The
 * floor under the default sun (65.6° elevation ⇒ a = 24.4°) wants 0.50 × 3
 * texels ≈ 1.5; 2.5 leaves headroom for more slanted receivers. The price is
 * peter-panning of `b / tan(elevation)` ≈ 1.9 cm on the floor at 4096, which
 * lands under the ContactShadows pass that draws the contact region anyway.
 */
const SHADOW_NORMAL_BIAS_TEXELS = 2.5

export function LightingRig() {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const wallHeight = useEditorStore((s) => s.scene.venue.wallHeight)
  const lighting = useEditorStore((s) => lightingOf(s.scene))
  const mode = LIGHTING_MODES[lighting.mode]
  const invalidate = useThree((s) => s.invalidate)
  const gl = useThree((s) => s.gl)

  /**
   * PLAN-05 C2. Absent means ON — the state every project was in before the
   * toggle existed, so nothing that opens without the field changes.
   *
   * What is deliberately NOT switched: `<Canvas shadows="percentage">` in
   * Scene3D (flipping `gl.shadowMap.enabled` recompiles every shader in the
   * scene on each click), the per-mesh `castShadow`/`receiveShadow` flags (they
   * are inert once no light casts, and rewriting them needs
   * `material.needsUpdate` across the whole scene), and the shadow map's own
   * ~67 MB allocation (freeing it needs a second dependency on `mapSize` to get
   * it back; the memory is a knowingly accepted cost).
   */
  const shadowsEnabled = lighting.shadowsEnabled ?? true

  // Absent means 'medium', which is the size this rig has always used.
  // Clamped because three clamps mapSize to the same limit silently: asking for
  // more than the GPU has would leave `mapSize` disagreeing with the map that
  // actually got allocated, and the normalBias arithmetic below reads mapSize.
  const mapSize = Math.min(
    SHADOW_MAP_SIZES[lighting.shadowSharpness ?? 'medium'],
    gl.capabilities.maxTextureSize,
  )

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
   * Re-allocate the depth target when the sharpness setting changes.
   *
   * `WebGLShadowMap.render` only builds one when `shadow.map === null`, so
   * writing a new `mapSize` on a live light does nothing whatsoever — which
   * presents as "the slider is not wired up" when it is really the renderer
   * still holding the old target. It has to be thrown away by hand.
   *
   * useLayoutEffect rather than useEffect so the first sizing lands before the
   * first demand frame and three never allocates its 512 default just to have
   * it disposed. And no `shadow-mapSize-*` JSX props on the light below: R3F
   * would reconcile them back over this on the next render.
   */
  useLayoutEffect(() => {
    const shadow = lightRef.current?.shadow
    if (!shadow || shadow.mapSize.width === mapSize) return
    shadow.map?.depthTexture?.dispose()
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(mapSize, mapSize)
    invalidate()
  }, [mapSize, invalidate])

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
      const content = shadowContent(useEditorStore.getState().scene, venueBounds, limit)
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
      // The map is square, so the wider axis sets the world size of a texel for
      // both, and the bias follows it — see SHADOW_NORMAL_BIAS_TEXELS.
      const texelM = Math.max(box.right - box.left, box.top - box.bottom) / mapSize
      light.shadow.normalBias = SHADOW_NORMAL_BIAS_TEXELS * texelM
      invalidate()
    }

    refit()
    return useEditorStore.subscribe((s) => s.scene.objects, refit)
  }, [W, D, H, cx, cz, sunX, sunY, sunZ, mapSize, invalidate])

  return (
    <>
      <hemisphereLight args={[mode.hemisphere.sky, mode.hemisphere.ground, mode.hemisphere.intensity]} />

      <primitive object={target} position={[cx, 0, cz]} />
      {/* No <orthographicCamera attach="shadow-camera"> here on purpose: the
          extents are driven imperatively above, and a JSX child would let R3F
          reconcile stale props back over them. The light's own default shadow
          camera is the one being configured. `shadow-mapSize-*` and
          `shadow-normalBias` are absent for the same reason — both are set in
          the effects above and both depend on numbers React does not have. */}
      <directionalLight
        ref={lightRef}
        position={[sunX, sunY, sunZ]}
        color={mode.sun.color}
        intensity={lighting.sunIntensity}
        castShadow={shadowsEnabled}
        shadow-radius={SHADOW_RADIUS}
        shadow-bias={SHADOW_BIAS}
      />

      {/* Grounding pass under the furniture. `blur` is the number that matters
          and it is NOT in texels: drei sets the blur shader's `h` to
          `blur / 256` in UV and the 9-tap Gaussian samples at ±1…4 h, so tap
          spacing in texels is `(blur / 256) * resolution`. At the old blur 2.4
          that is 9.6 texels — this 61.51 x 26.44 m scale goes into a SQUARE
          1024² target (6.01 cm a texel on x, 2.58 on z), so the taps stood 58 cm
          apart and drew nine ghosted copies of every table spread over 4.6 m.
          That, not the resolution, is the blockiness at the edges of the floor.
          0.5 puts the taps 2 texels apart ⇒ ±0.48 m of penumbra on the long
          axis. Rule to keep: `(blur / 256) * resolution <= ~2`.
          Raising `resolution` cannot fix this — h is in UV, so the taps stay the
          same world distance apart no matter how fine the target is.
          Unmounted rather than made transparent when the toggle is off: this is
          a separate pass with its own render target, so taking it out of the
          tree is both the cheapest and the only complete way to remove it. */}
      {shadowsEnabled && (
        <ContactShadows
          position={[cx, 0.012, cz]}
          scale={[W + 1, D + 1]}
          far={cmToM(220)}
          blur={0.5}
          opacity={0.35}
          resolution={1024}
          color="#3a352f"
        />
      )}
    </>
  )
}
