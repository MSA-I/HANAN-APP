/**
 * The band a table is turned by, in 3D.
 *
 * WHY THIS REPLACED drei's `TransformControls` (verified in
 * `three/examples/jsm/controls/TransformControls.js`, not assumed):
 *
 *  - The ring you SEE is `CircleGeometry(0.5, 0.5)` (`:1316`), and that helper is
 *    `TorusGeometry(radius, 0.0075, 3, 64, arc * 2π)` (`:1210`) — arc 0.5 is a
 *    HALF circle. The thing you can GRAB is `TorusGeometry(0.5, 0.1, 4, 24)`
 *    (`:1340`), a full one. Half the grabbable region draws nothing at all.
 *  - A world-Y ring projects to a near-flat line at eye height, and the `eye`
 *    preset plus all five sealed cameras sit at y≈1.55–1.77 m. It degenerates
 *    exactly where this app lives.
 *  - It centres on the object's ORIGIN, which for a table is buried mid-top.
 *  - `showX/showZ={false}` only reaches `handle.visible = false` (`:1782-1785`),
 *    in a loop that walks `picker[mode].children` too (`:1774`) — and three's
 *    raycaster tests `object.layers`, never `visible` (`Raycaster.js:240`), while
 *    `Mesh.raycast` never looks at `material.visible` either. The hidden X and Z
 *    pickers stayed fully grabbable. That is the whole reason ObjectGroup carried
 *    a module-level `activeGizmo` singleton, and it is deleted with this.
 *  - It installs its own `domElement` `pointerdown` listener (`:372`) and races
 *    R3F's.
 *  - No readout, no Hebrew, no styling hook.
 *
 * WHAT THIS IS INSTEAD. A band that traces the table's OWN footprint via
 * `core/layout/rotateHandle.ts` — an annulus for a round table, a rounded-rect
 * band for a rectangular one, so a 480×120 knights table gets a band that hugs it
 * rather than a ⌀990 circle floating two metres off each end. The ENTIRE band is
 * the hit target: on a ⌀180 table that is roughly two metres of circumference
 * against the old gizmo's ~17 px torus.
 *
 * COST. Band + four heading knobs are merged into ONE `BufferGeometry`, cached by
 * shape, and drawn by ONE mesh with ONE material — 1 draw call, against roughly
 * 80 meshes for the gizmo it replaces. The second material is the ACTIVE twin,
 * swapped in during a drag; only ever one of the two is mounted.
 *
 * THE DRAG IS A PLANE INTERSECTION, not a screen-space delta and not three's
 * `eye`-plane projection: the pointer ray is crossed with the horizontal plane at
 * the table top, which is exact at any camera pitch — including the eye height
 * where the old ring collapsed. `isUsableRotationHit` throws out the two ways
 * that intersection goes bad (a ray too near parallel to the floor, and a hit
 * that lands out in the car park).
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import type { Outline } from '../core/catalog/types'
import {
  isUsableRotationHit,
  planAngleBetween,
  rotateRingRadius,
  rotateRingShape,
  rotationFromDrag,
  type RotateRing,
} from '../core/layout/rotateHandle'
import type { Id } from '../core/model/types'
import { ROTATION_SNAP_DEG } from '../core/rotation'
import { cmToM, threeToPlan } from '../core/space'
import { useOverlayStore } from '../editor2d/overlayStore'
import { beginGesture, endGesture, setRotation } from '../state/actions'
import { useEditorStore } from '../state/store'
import { LruCache } from './lru'
import { SELECT_TINT } from './meshCache'

/** How far outside the footprint the band's inner edge sits, and how wide it is. */
const RING_GAP_CM = 12
const RING_BAND_CM = 9

/** Clear of the table top, so the band never z-fights the cloth it hovers over. */
const RING_LIFT_CM = 2

/** Corner smoothness of the rect band, and of the annulus. */
const CORNER_SEGMENTS = 6
const CIRCLE_SEGMENTS = 64

/** The four heading knobs — what tells you which way the table is facing. */
const KNOB_SEGMENTS = 14
const KNOB_RADIUS_FACTOR = 0.85

/**
 * Bounded like every other geometry cache in the viewer: the key is the SHAPE,
 * so the working set is (table entries × sizes the user has tried), and a resize
 * drag would otherwise leave one merged band per intermediate width resident for
 * the session — the leak `meshCache`'s ceiling exists to stop.
 */
const ringCache = new LruCache<THREE.BufferGeometry>(120, (g) => g.dispose())

function ringKey(ring: RotateRing): string {
  return ring.kind === 'circle'
    ? `c|${ring.rInner}|${ring.rOuter}`
    : `r|${ring.w}|${ring.h}|${ring.corner}|${ring.band}`
}

/**
 * A rounded rectangle centred on the origin, as a three `Path` — the outer edge
 * of the band when called with the outer numbers, the hole when called with the
 * inner ones. `absarc` rather than `quadraticCurveTo` so the corner is a true
 * circular arc and the band keeps a constant width all the way round; a quadratic
 * approximation pinches visibly at 45°.
 */
function roundedRectPath<T extends THREE.Path>(
  path: T,
  w: number,
  h: number,
  radius: number,
): T {
  const hw = w / 2
  const hh = h / 2
  const r = Math.max(0, Math.min(radius, hw, hh))
  path.moveTo(-hw + r, -hh)
  path.lineTo(hw - r, -hh)
  path.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false)
  path.lineTo(hw, hh - r)
  path.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false)
  path.lineTo(-hw + r, hh)
  path.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(-hw, -hh + r)
  path.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false)
  return path
}

/** The band alone, in the XY plane and in metres — laid flat by the caller. */
function bandGeometry(ring: RotateRing): THREE.BufferGeometry {
  if (ring.kind === 'circle') {
    return new THREE.RingGeometry(cmToM(ring.rInner), cmToM(ring.rOuter), CIRCLE_SEGMENTS, 1)
  }
  const half = ring.band / 2
  const shape = roundedRectPath(
    new THREE.Shape(),
    cmToM(ring.w + ring.band),
    cmToM(ring.h + ring.band),
    cmToM(ring.corner + half),
  )
  shape.holes.push(
    roundedRectPath(
      new THREE.Path(),
      cmToM(ring.w - ring.band),
      cmToM(ring.h - ring.band),
      cmToM(Math.max(0, ring.corner - half)),
    ),
  )
  return new THREE.ShapeGeometry(shape, CORNER_SEGMENTS)
}

/** How wide the band is, whichever variant it is — a circle states it as a pair of radii. */
function bandWidth(ring: RotateRing): number {
  return ring.kind === 'circle' ? ring.rOuter - ring.rInner : ring.band
}

/** Where the four knobs sit — on the band's CENTRELINE, at the cardinals. */
function knobCentres(ring: RotateRing): [number, number][] {
  if (ring.kind === 'circle') {
    const r = (ring.rInner + ring.rOuter) / 2
    return [
      [0, r],
      [0, -r],
      [r, 0],
      [-r, 0],
    ]
  }
  return [
    [0, ring.h / 2],
    [0, -ring.h / 2],
    [ring.w / 2, 0],
    [-ring.w / 2, 0],
  ]
}

/**
 * Band + knobs as ONE geometry, already lying in the XZ plane so the mesh needs
 * no rotation of its own (a mesh rotation would fight the group's, which carries
 * the table's heading).
 */
function rotateRingGeometry(ring: RotateRing): THREE.BufferGeometry {
  const key = ringKey(ring)
  const cached = ringCache.get(key)
  if (cached) return cached

  const pieces: THREE.BufferGeometry[] = [bandGeometry(ring)]
  const knobR = cmToM(bandWidth(ring) * KNOB_RADIUS_FACTOR)
  for (const [x, y] of knobCentres(ring)) {
    const knob = new THREE.CircleGeometry(knobR, KNOB_SEGMENTS)
    knob.translate(cmToM(x), cmToM(y), 0)
    pieces.push(knob)
  }

  const merged = mergeGeometries(pieces, false) ?? pieces[0]
  for (const piece of pieces) if (piece !== merged) piece.dispose()
  // built in XY like every three shape helper; -90° about X lays it on the floor.
  // Plan +y is screen-down and three +z is plan +y, so this also puts the knob we
  // authored at +y on the table's -z — the direction a 0° object faces.
  merged.rotateX(-Math.PI / 2)
  ringCache.set(key, merged)
  return merged
}

/**
 * Unlit and depth-blind on purpose: a handle is a control, not a prop. It must
 * not take the room's lighting (a band that goes dark under `night` is a band the
 * user cannot find), and it must draw over the table it hugs rather than sinking
 * into a tablecloth 2 cm below it.
 *
 * Two of them, built once. `active` is what the band wears mid-drag — the only
 * feedback that the grab actually took, since the table itself may refuse the
 * angle. Never mutated: they are shared by every ring on screen.
 */
function ringMaterial(active: boolean): THREE.MeshBasicMaterial {
  const cached = active ? activeMaterial : idleMaterial
  if (cached) return cached
  const material = new THREE.MeshBasicMaterial({
    color: SELECT_TINT,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: active ? 1 : 0.78,
    toneMapped: false,
  })
  if (active) activeMaterial = material
  else idleMaterial = material
  return material
}

let idleMaterial: THREE.MeshBasicMaterial | null = null
let activeMaterial: THREE.MeshBasicMaterial | null = null

/** Above everything else the viewer draws, so nothing can bury the control. */
const RING_RENDER_ORDER = 999

interface RotationDragState {
  pointerId: number
  startRotation: number
  startAngle: number
  centre: { x: number; y: number }
  ringRadiusCm: number
  plane: THREE.Plane
  capture: Element
  previousCursor: string
  move: (event: PointerEvent) => void
  end: (event: PointerEvent) => void
}

interface Props {
  id: Id
  outline: Outline
  /** the object's own height in cm — the band floats just clear of its top */
  heightCm: number
}

export function RotateHandle({ id, outline, heightCm }: Props) {
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const dragRef = useRef<RotationDragState | null>(null)
  const meshRef = useRef<THREE.Mesh>(null)

  const ring = useMemo(
    () => rotateRingShape(outline, RING_GAP_CM, RING_BAND_CM),
    [outline],
  )
  const geometry = useMemo(() => rotateRingGeometry(ring), [ring])
  const ringRadiusCm = useMemo(() => rotateRingRadius(ring), [ring])

  /** A drag that outlives its own component must still close its history entry. */
  useEffect(
    () => () => {
      const drag = dragRef.current
      if (!drag) return
      window.removeEventListener('pointermove', drag.move)
      window.removeEventListener('pointerup', drag.end)
      window.removeEventListener('pointercancel', drag.end)
      if (drag.capture.hasPointerCapture(drag.pointerId)) {
        drag.capture.releasePointerCapture(drag.pointerId)
      }
      gl.domElement.style.cursor = drag.previousCursor
      dragRef.current = null
      endGesture()
    },
    [gl],
  )

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    const state = useEditorStore.getState()
    const obj = state.scene.objects[id]
    const mesh = meshRef.current
    if (!obj || !mesh) return

    /**
     * Centre and plane both come off the band's own WORLD matrix, never off
     * `obj.transform`. A surface child's transform is PARENT-LOCAL — a
     * centrepiece on a table reads (0, 0) — while the pointer ray is crossed
     * with a world plane, so mixing the two would swing every decor item around
     * the hall's origin. Reading the matrix also picks up the +4.70 m reception
     * deck and any hang height for free, with no elevation arithmetic here to
     * drift from `groundHeight.ts`.
     */
    const world = mesh.getWorldPosition(new THREE.Vector3())
    const centre = threeToPlan(world.x, world.z)
    // the band floats RING_LIFT_CM above the top; the drag plane is the top itself
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.y - cmToM(RING_LIFT_CM)))
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return
    const point = threeToPlan(hit.x, hit.z)
    if (!isUsableRotationHit(centre, point, ringRadiusCm, e.ray.direction.y)) return
    const capture = e.nativeEvent.target
    if (!(capture instanceof Element)) return

    // THE line that retires `gizmoBusy()`. This mesh is a child of the object's
    // group and R3F bubbles up the object tree, so stopping here is what keeps
    // the parent's floor-drag from starting underneath the rotation.
    e.stopPropagation()

    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const moveHit = new THREE.Vector3()
    const drag: RotationDragState = {
      pointerId: e.pointerId,
      // the object's OWN rotation, because `setRotation` writes that field. The
      // swept delta below is a world angle, and adding a world delta to a local
      // rotation is exact for as long as the parent does not turn mid-drag — and
      // nothing can turn it while this pointer is captured.
      startRotation: obj.transform.rotation,
      startAngle: planAngleBetween(centre, point),
      centre,
      ringRadiusCm,
      plane,
      capture,
      previousCursor: gl.domElement.style.cursor,
      move: () => {},
      end: () => {},
    }

    drag.move = (event) => {
      if (event.pointerId !== drag.pointerId) return
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(drag.plane, moveHit)) return
      const current = threeToPlan(moveHit.x, moveHit.z)
      if (
        !isUsableRotationHit(drag.centre, current, drag.ringRadiusCm, raycaster.ray.direction.y)
      ) {
        return
      }
      // Shift opts INTO the snap; free is the default (core/rotation.ts). Read at
      // move time rather than latched at grab, so the user can change their mind
      // mid-turn without letting go.
      setRotation(
        id,
        rotationFromDrag({
          startRotation: drag.startRotation,
          startAngle: drag.startAngle,
          currentAngle: planAngleBetween(drag.centre, current),
          snapDeg: useOverlayStore.getState().shiftHeld ? ROTATION_SNAP_DEG : 0,
        }),
      )
      event.preventDefault()
    }

    drag.end = (event) => {
      if (event.pointerId !== drag.pointerId || dragRef.current !== drag) return
      window.removeEventListener('pointermove', drag.move)
      window.removeEventListener('pointerup', drag.end)
      window.removeEventListener('pointercancel', drag.end)
      if (drag.capture.hasPointerCapture(drag.pointerId)) {
        drag.capture.releasePointerCapture(drag.pointerId)
      }
      gl.domElement.style.cursor = drag.previousCursor
      dragRef.current = null
      if (meshRef.current) meshRef.current.material = ringMaterial(false)
      setRotating(false)
      invalidate()
      endGesture()
    }

    dragRef.current = drag
    beginGesture()
    setRotating(true)
    capture.setPointerCapture(e.pointerId)
    gl.domElement.style.cursor = 'grabbing'
    // swapped imperatively, not through state: a re-render here would cost the
    // whole object subtree on the first frame of every rotation
    if (meshRef.current) meshRef.current.material = ringMaterial(true)
    invalidate()
    window.addEventListener('pointermove', drag.move)
    window.addEventListener('pointerup', drag.end)
    window.addEventListener('pointercancel', drag.end)
  }

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      material={ringMaterial(false)}
      position={[0, cmToM(heightCm + RING_LIFT_CM), 0]}
      renderOrder={RING_RENDER_ORDER}
      onPointerDown={handlePointerDown}
      // the press is already stopped above; these two stop the SECOND half of the
      // gesture reaching the table — without them a double-click on the band would
      // open design-edit mode on the very table being turned
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerOver={() => {
        gl.domElement.style.cursor = 'grab'
      }}
      onPointerOut={() => {
        if (!dragRef.current) gl.domElement.style.cursor = ''
      }}
    />
  )
}

/**
 * Whether a rotation drag is running, for the hint strip and the bar's readout.
 *
 * A module-level flag with subscribers rather than a store field: it changes
 * twice per gesture and is read by two DOM chips, and putting it in the editor
 * store would make every rotation a store write that the whole 3D tree
 * re-evaluates its selectors against. Only one ring can be dragged at a time —
 * the handle mounts for a single selection.
 */
let rotating = false
const rotationListeners = new Set<(active: boolean) => void>()

function setRotating(active: boolean): void {
  if (rotating === active) return
  rotating = active
  for (const listener of rotationListeners) listener(active)
}

export function isRotating(): boolean {
  return rotating
}

export function onRotatingChange(listener: (active: boolean) => void): () => void {
  rotationListeners.add(listener)
  return () => {
    rotationListeners.delete(listener)
  }
}
