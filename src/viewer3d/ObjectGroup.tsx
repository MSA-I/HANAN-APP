/**
 * The one generic object renderer — it interprets the catalog, never hardcodes
 * furniture. A three.Group is placed by the object's plan transform; its
 * children are the merged per-slot meshes from the catalog's buildMesh, plus
 * instanced chairs for a seated table (mirroring the 2D parent/child nesting).
 *
 * Performance shape:
 * - Transform changes are applied TRANSIENTLY (store.subscribe → group matrix),
 *   so dragging a table costs one matrix write, not a React re-render.
 * - Structural/appearance/size changes come through the normal React path via
 *   per-field selectors that stay reference-stable across transform-only edits
 *   (Immer structural sharing), so drags don't trip them.
 * - A table's chairs render as one InstancedMesh per material slot, so 10 chairs
 *   cost 2 draw calls and follow the table for free (they live in its group).
 */
import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { TransformControls } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { getCatalogEntry } from '../core/catalog/registry'
import { slotColor, type Outline } from '../core/catalog/types'
import { beamGrid, cordLength, snapToBeam } from '../core/layout/beams'
import { snapValue } from '../core/layout/snapping'
import { attachedChairs } from '../core/model/seatingReconciler'
import type { Id, Size3D } from '../core/model/types'
import { cmToM, degToRad, radToDeg } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { useOverlayStore } from '../editor2d/overlayStore'
import { beginGesture, endGesture, select, setPosition, setRotation, toggleSelect } from '../state/actions'
import { isEffectivelyLocked, isLayerHidden, isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import {
  instancedChairMaterial,
  objectSlotGeometries,
  selectedSlotMaterial,
  SELECT_TINT,
  slotMaterial,
} from './meshCache'
import { applyPlanTransform, planTransformMatrix } from './planTransform'
import { commitPlacement3D, previewPlacement3D } from './Placement3D'
import { useModelParts } from './propModel'
import { slotTextureUrl, useSlotTexture } from './slotTextures'

const SELECT_COLOR = new THREE.Color(SELECT_TINT)

/** No pack, no measured truss to match — the cord stays the near-black it always was. */
const DEFAULT_CORD_COLOR = '#2a2a2a'

type MoveDrag = {
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  plane: THREE.Plane
  hit: THREE.Vector3
  capture: Element
  previousCursor: string
  moved: boolean
  move: (event: PointerEvent) => void
  end: (event: PointerEvent) => void
}

type GizmoControls = React.ComponentRef<typeof TransformControls>
/** `dragging` and `axis` are public on three's TransformControls but typed private by three-stdlib. */
type GizmoState = { dragging: boolean; axis: string | null }
const gizmoState = (c: GizmoControls | null): GizmoState | null => c as unknown as GizmoState | null

/**
 * The one mounted rotation gizmo, or null.
 *
 * The gizmo's picker meshes are INVISIBLE but still raycastable (three only
 * tests layers, not `visible`), and they live inside the selected object's
 * group — so a click on the rotation ring also lands on the object and used to
 * start a move drag on top of the rotation. Every pointer-down therefore has to
 * be able to ask "did this hit the gizmo?", including surface children, whose
 * own gizmo sits inside their parent's group.
 *
 * `axis` is the reliable signal: TransformControls sets it during pointer HOVER,
 * so it is already non-null by the time our pointer-down handler runs, whereas
 * `dragging` is set from the controls' own pointerdown listener, which races
 * with R3F's.
 *
 * ponytail: a module-level singleton, because `canRotate` requires a single
 * selection so at most one handle can be mounted. If multi-select ever grows
 * per-object gizmos, make this a set keyed by object id.
 */
let activeGizmo: GizmoControls | null = null

function gizmoBusy(): boolean {
  const g = gizmoState(activeGizmo)
  return !!g && (g.dragging || g.axis !== null)
}

/** A single-axis editor handle; every drag is one history entry. */
function RotationHandle({ id, object }: { id: Id; object: THREE.Object3D }) {
  const shiftHeld = useOverlayStore((s) => s.shiftHeld)
  const dragging = useRef(false)
  const controlsRef = useRef<GizmoControls | null>(null)

  const bindControls = useCallback((controls: GizmoControls | null) => {
    controlsRef.current = controls
    activeGizmo = controls
  }, [])

  useEffect(
    () => () => {
      if (dragging.current) endGesture()
      if (activeGizmo === controlsRef.current) activeGizmo = null
    },
    [],
  )

  return (
    <TransformControls
      ref={bindControls}
      object={object}
      mode="rotate"
      space="world"
      size={0.82}
      showX={false}
      showY
      showZ={false}
      // Free rotation by default; Shift engages 5° detents (source doc §25).
      // Must mirror SelectionTransformer.tsx or 2D and 3D behave opposite ways.
      rotationSnap={shiftHeld ? degToRad(5) : null}
      onMouseDown={() => {
        dragging.current = true
        beginGesture()
      }}
      onObjectChange={() => {
        setRotation(id, -radToDeg(object.rotation.y))
      }}
      onMouseUp={() => {
        if (!dragging.current) return
        dragging.current = false
        endGesture()
      }}
    />
  )
}

export function ObjectGroup({ id }: { id: Id }) {
  const groupRef = useRef<THREE.Group>(null)
  const dragRef = useRef<MoveDrag | null>(null)
  const suppressClick = useRef(false)
  const [rotationTarget, setRotationTarget] = useState<THREE.Group | null>(null)
  const bindGroup = useCallback((group: THREE.Group | null) => {
    groupRef.current = group
    setRotationTarget(group)
  }, [])
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  // Per-field selectors: these references are stable across transform-only edits
  // (Immer only clones the path that changed), so a drag never re-renders here.
  const catalogId = useEditorStore((s) => s.scene.objects[id]?.catalogId)
  const size = useEditorStore((s) => s.scene.objects[id]?.size)
  const appearance = useEditorStore((s) => s.scene.objects[id]?.appearance)
  const hasSeating = useEditorStore((s) => !!s.scene.objects[id]?.seating)
  const seatingHidden = useEditorStore((s) => isLayerHidden(s.scene, 'seating'))
  const isSelected = useEditorStore((s) => s.selection.includes(id))
  const canRotate = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    return s.selection.length === 1 && s.selection[0] === id && !!obj && !isEffectivelyLocked(s.scene, obj)
  })
  const placing = useOverlayStore((s) => s.placing)
  const baseElevation = useEditorStore((s) => {
    const zoneKind = catalogId ? getCatalogEntry(catalogId).zoneKind : undefined
    return getVenuePack(s.scene.venue.venuePackId)?.restricted?.find((zone) => zone.kind === zoneKind)?.elevation ?? 0
  })
  // a NUMBER selector, so it stays stable through the transient position writes
  // of a drag and only re-renders when the hang slider actually moves
  const drop = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    if (!obj || getCatalogEntry(obj.catalogId).placement !== 'ceiling') return 0
    return cordLength(
      getVenuePack(s.scene.venue.venuePackId),
      s.scene.venue.wallHeight,
      obj.size.height,
      obj.transform.elevation,
    )
  })
  // The cord is the roof truss's own metal (source doc §16). PLAN-01 measured it
  // off venue.glb: #ddd1c1 at metalness/roughness 0.5 — a warm beige, NOT steel
  // (Plans/R2/handoff/01-venue-data.md §6), so the cord's PBR matches those.
  const cordColor = useEditorStore(
    (s) => getVenuePack(s.scene.venue.venuePackId)?.beamColor ?? DEFAULT_CORD_COLOR,
  )

  // Transient transform sync — the hot path. fireImmediately seeds the initial
  // placement; subsequent drag frames update the matrix without React.
  useLayoutEffect(() => {
    return useEditorStore.subscribe(
      (s) => s.scene.objects[id]?.transform,
      (t) => {
        if (t && groupRef.current) {
          applyPlanTransform(groupRef.current, t, baseElevation)
          invalidate()
        }
      },
      { equalityFn: shallow, fireImmediately: true },
    )
  }, [id, invalidate, baseElevation])

  useEffect(
    () => () => {
      const drag = dragRef.current
      if (!drag) return
      window.removeEventListener('pointermove', drag.move)
      window.removeEventListener('pointerup', drag.end)
      window.removeEventListener('pointercancel', drag.end)
      if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId)
      gl.domElement.style.cursor = drag.previousCursor
      dragRef.current = null
      endGesture()
    },
    [gl],
  )

  const geometries = useMemo(
    () => (catalogId && size ? objectSlotGeometries(catalogId, size) : []),
    [catalogId, size],
  )

  if (!catalogId || !size || !appearance) return null
  const entry = getCatalogEntry(catalogId)

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (suppressClick.current) {
      suppressClick.current = false
      e.stopPropagation()
      return
    }
    if (placing) {
      e.stopPropagation()
      commitPlacement3D(e.point, e.nativeEvent.altKey, id)
      return
    }
    e.stopPropagation()
    if (e.nativeEvent.shiftKey) toggleSelect(id)
    else select([id])
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    suppressClick.current = false
    if (placing || e.button !== 0 || e.nativeEvent.shiftKey || gizmoBusy()) return
    const state = useEditorStore.getState()
    const obj = state.scene.objects[id]
    if (!obj || obj.parentId || isEffectivelyLocked(state.scene, obj)) return

    const plane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -cmToM(baseElevation + obj.transform.elevation),
    )
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return
    const capture = e.nativeEvent.target
    if (!(capture instanceof Element)) return

    e.stopPropagation()
    if (state.selection.length !== 1 || state.selection[0] !== id) select([id])
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: obj.transform.position.x - hit.x * 100,
      offsetY: obj.transform.position.y - hit.z * 100,
      plane,
      hit,
      capture,
      previousCursor: gl.domElement.style.cursor,
      moved: false,
    } as MoveDrag
    drag.move = (event) => {
      if (event.pointerId !== drag.pointerId) return
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3) return
      drag.moved = true
      const rect = gl.domElement.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(drag.plane, drag.hit)) return

      const scene = useEditorStore.getState().scene
      const x = drag.hit.x * 100 + drag.offsetX
      const y = drag.hit.z * 100 + drag.offsetY
      // a hung fixture rides the beam crossings, never the floor grid (§12)
      if (getCatalogEntry(scene.objects[id].catalogId).placement === 'ceiling') {
        const pack = getVenuePack(scene.venue.venuePackId)
        setPosition(id, snapToBeam({ x, y }, beamGrid(pack, scene.venue.size)))
      } else {
        setPosition(
          id,
          scene.settings.snapEnabled && !event.altKey
            ? { x: snapValue(x, scene.settings.gridSize), y: snapValue(y, scene.settings.gridSize) }
            : { x, y },
        )
      }
      event.preventDefault()
    }
    drag.end = (event) => {
      if (event.pointerId !== drag.pointerId || dragRef.current !== drag) return
      window.removeEventListener('pointermove', drag.move)
      window.removeEventListener('pointerup', drag.end)
      window.removeEventListener('pointercancel', drag.end)
      if (drag.capture.hasPointerCapture(drag.pointerId)) drag.capture.releasePointerCapture(drag.pointerId)
      gl.domElement.style.cursor = drag.previousCursor
      dragRef.current = null
      suppressClick.current = drag.moved
      endGesture()
    }
    dragRef.current = drag
    beginGesture()
    capture.setPointerCapture(e.pointerId)
    gl.domElement.style.cursor = 'grabbing'
    window.addEventListener('pointermove', drag.move)
    window.addEventListener('pointerup', drag.end)
    window.addEventListener('pointercancel', drag.end)
  }

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (placing) {
      e.stopPropagation()
      previewPlacement3D(e.point, id)
    }
  }

  const procedural = geometries.map(({ slot, geometry }) => {
    const color = slotColor(entry, appearance, slot)
    return (
      <mesh
        key={slot}
        geometry={geometry}
        material={isSelected ? selectedSlotMaterial(color) : slotMaterial(color)}
        castShadow
        receiveShadow
      />
    )
  })

  return (
    <>
      <group
        ref={bindGroup}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {entry.model ? (
          <ModelFallback fallback={procedural}>
            <ModelParts
              catalogId={catalogId}
              url={entry.model}
              size={size}
              slot={entry.editableColorSlot}
              color={entry.editableColorSlot ? appearance[entry.editableColorSlot]?.color : undefined}
            />
          </ModelFallback>
        ) : (
          procedural
        )}
        {isSelected && <SelectionOutline outline={entry.footprint(size).outline} />}
        {drop > 0 && <HangingCord from={size.height} length={drop} color={cordColor} />}
        {hasSeating && !seatingHidden && <ChairInstances tableId={id} />}
        <SurfaceChildren parentId={id} />
      </group>
      {canRotate && !placing && rotationTarget && <RotationHandle id={id} object={rotationTarget} />}
    </>
  )
}

/** Decor standing on this object's top — each child in its own local group. */
function SurfaceChildren({ parentId }: { parentId: Id }) {
  const ids = useEditorStore(
    useShallow((s) =>
      Object.values(s.scene.objects)
        .filter(
          (o) =>
            o.parentId === parentId &&
            o.attachment?.kind === 'surface' &&
            isObjectVisible(s.scene, o.id),
        )
        .map((o) => o.id),
    ),
  )
  return (
    <>
      {ids.map((id) => (
        <SurfaceChild key={id} id={id} parentId={parentId} />
      ))}
    </>
  )
}

/**
 * One surface decor. Mirrors ObjectGroup's shape (transient transform, GLB with
 * procedural fallback) but lives INSIDE the parent's group, so its transform is
 * parent-local with elevation = the parent's height (set by the actions layer).
 */
function SurfaceChild({ id, parentId }: { id: Id; parentId: Id }) {
  const groupRef = useRef<THREE.Group>(null)
  const [rotationTarget, setRotationTarget] = useState<THREE.Group | null>(null)
  const bindGroup = useCallback((group: THREE.Group | null) => {
    groupRef.current = group
    setRotationTarget(group)
  }, [])
  const invalidate = useThree((s) => s.invalidate)
  const catalogId = useEditorStore((s) => s.scene.objects[id]?.catalogId)
  const size = useEditorStore((s) => s.scene.objects[id]?.size)
  const appearance = useEditorStore((s) => s.scene.objects[id]?.appearance)
  const isSelected = useEditorStore((s) => s.selection.includes(id))
  const canRotate = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    return s.selection.length === 1 && s.selection[0] === id && !!obj && !isEffectivelyLocked(s.scene, obj)
  })
  const placing = useOverlayStore((s) => s.placing)

  useLayoutEffect(() => {
    return useEditorStore.subscribe(
      (s) => s.scene.objects[id]?.transform,
      (t) => {
        if (t && groupRef.current) {
          applyPlanTransform(groupRef.current, t)
          invalidate()
        }
      },
      { equalityFn: shallow, fireImmediately: true },
    )
  }, [id, invalidate])

  const geometries = useMemo(
    () => (catalogId && size ? objectSlotGeometries(catalogId, size) : []),
    [catalogId, size],
  )

  if (!catalogId || !size || !appearance) return null
  const entry = getCatalogEntry(catalogId)

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (placing) {
      e.stopPropagation()
      commitPlacement3D(e.point, e.nativeEvent.altKey, parentId)
      return
    }
    e.stopPropagation()
    // mirror chairs: a click selects the TABLE, unless this decor is already selected
    const sel = useEditorStore.getState().selection
    const target = sel.includes(id) ? id : parentId
    if (e.nativeEvent.shiftKey) toggleSelect(target)
    else select([target])
  }

  const handlePointerMove = placing
    ? (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        previewPlacement3D(e.point, parentId)
      }
    : undefined

  const procedural = geometries.map(({ slot, geometry }) => {
    const color = slotColor(entry, appearance, slot)
    return (
      <mesh
        key={slot}
        geometry={geometry}
        material={isSelected ? selectedSlotMaterial(color) : slotMaterial(color)}
        castShadow
        receiveShadow
      />
    )
  })

  return (
    <>
      <group ref={bindGroup} onClick={handleClick} onPointerMove={handlePointerMove}>
        {entry.model ? (
          <ModelFallback fallback={procedural}>
            <ModelParts
              catalogId={catalogId}
              url={entry.model}
              size={size}
              slot={entry.editableColorSlot}
              color={entry.editableColorSlot ? appearance[entry.editableColorSlot]?.color : undefined}
            />
          </ModelFallback>
        ) : (
          procedural
        )}
        {isSelected && <SelectionOutline outline={entry.footprint(size).outline} />}
      </group>
      {canRotate && !placing && rotationTarget && <RotationHandle id={id} object={rotationTarget} />}
    </>
  )
}

/**
 * The real GLB of a catalog entry. An editable appearance override gets private
 * cloned materials, keeping textures/PBR data intact without tinting other instances.
 *
 * An override is a tint, a `map`, or both. The map comes from `slotTextures.ts`,
 * which is empty today: with nothing registered for the slot this is the same
 * clone-and-tint it always was. Both are applied to the CLONE — the cached
 * material in `propModel.partCache` is never touched, so no cache key has to
 * carry the texture (BRIEF §1.8).
 */
function ModelParts({
  catalogId,
  url,
  size,
  slot,
  color,
}: {
  catalogId: string
  url: string
  size: Size3D
  slot?: string
  color?: string
}) {
  const parts = useModelParts(catalogId, url, size)
  const invalidate = useThree((s) => s.invalidate)
  const map = useSlotTexture(slotTextureUrl(catalogId, slot))
  const overriddenMaterials = useMemo(
    () =>
      color || map
        ? parts.map(({ material }) => {
            const clone = material.clone()
            const tintable = clone as THREE.Material & {
              color?: THREE.Color
              map?: THREE.Texture | null
            }
            if (color && tintable.color?.isColor) tintable.color.set(color)
            if (map && 'map' in clone) {
              tintable.map = map
              clone.needsUpdate = true
            }
            return clone
          })
        : null,
    [color, map, parts],
  )
  // frameloop is "demand": a texture that arrives after the object was drawn has
  // to ask for the frame that shows it
  useEffect(() => invalidate(), [overriddenMaterials, invalidate])
  useEffect(
    () => () => {
      // the clones are ours; the texture is shared per URL and outlives them
      overriddenMaterials?.forEach((material) => material.dispose())
    },
    [overriddenMaterials],
  )
  return (
    <>
      {parts.map(({ key, geometry, material }, index) => (
        <mesh
          key={key}
          geometry={geometry}
          material={overriddenMaterials?.[index] ?? material}
          castShadow
          receiveShadow
        />
      ))}
    </>
  )
}

/** Procedural mesh stands in while a prop GLB loads, and if it fails to load. */
class PropErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function ModelFallback({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return (
    <PropErrorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </PropErrorBoundary>
  )
}

/**
 * Suspension cord for a fixture pulled below its seeded height (source doc §13:
 * "some of the chandeliers need a cord added so it does not look disconnected").
 * Only the EXTRA drop is drawn — each GLB already models its own cord down to the
 * catalogued height — so at the top of the range nothing is added at all. That
 * last 15 cm to the beam was tried and photographed; see `cordLength`.
 *
 * 3 cm across and 6-sided: a cord reads as a line at any sane camera distance, so
 * a rounder or thicker one only costs triangles. `raycast` off, or the cord would
 * shield the fixture from clicks along its whole length.
 *
 * `color` is the venue's own truss metal, so the cord reads as part of the roof
 * rather than as a black wire hung off it (source doc §16). Its metalness and
 * roughness are the beams' measured 0.5/0.5 — the resort truss is warm beige, not
 * polished steel, and a shinier cord next to a matte beam looks like a mistake.
 */
function HangingCord({ from, length, color }: { from: number; length: number; color: string }) {
  return (
    <mesh position={[0, cmToM(from + length / 2), 0]} raycast={() => null} castShadow>
      <cylinderGeometry args={[cmToM(1.5), cmToM(1.5), cmToM(length), 6]} />
      <meshStandardMaterial color={color} metalness={0.5} roughness={0.5} />
    </mesh>
  )
}

/** A flat accent ring/frame on the floor beneath the selected object. */
function SelectionOutline({ outline }: { outline: Outline }) {
  const geometry = useMemo(() => {
    if (outline.kind === 'circle') {
      const r = cmToM(outline.r)
      return new THREE.RingGeometry(r * 0.99, r + cmToM(4), 56)
    }
    const w = cmToM(outline.w)
    const h = cmToM(outline.h)
    const t = cmToM(4)
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2 - t, -h / 2 - t)
    shape.lineTo(w / 2 + t, -h / 2 - t)
    shape.lineTo(w / 2 + t, h / 2 + t)
    shape.lineTo(-w / 2 - t, h / 2 + t)
    shape.closePath()
    const hole = new THREE.Path()
    hole.moveTo(-w / 2, -h / 2)
    hole.lineTo(w / 2, -h / 2)
    hole.lineTo(w / 2, h / 2)
    hole.lineTo(-w / 2, h / 2)
    hole.closePath()
    shape.holes.push(hole)
    return new THREE.ShapeGeometry(shape)
  }, [outline])

  useLayoutEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.006, 0]}
      raycast={() => null}
    >
      <meshBasicMaterial color={SELECT_TINT} transparent opacity={0.9} side={THREE.DoubleSide} />
    </mesh>
  )
}

/** All chairs of one table, one InstancedMesh per material slot. */
function ChairInstances({ tableId }: { tableId: Id }) {
  const invalidate = useThree((s) => s.invalidate)
  const chairs = useEditorStore(useShallow((s) => attachedChairs(s.scene, tableId)))
  const selection = useEditorStore(useShallow((s) => s.selection))

  const built = useMemo(() => {
    if (chairs.length === 0) return null
    const entry = getCatalogEntry(chairs[0].catalogId)
    const geoms = objectSlotGeometries(chairs[0].catalogId, chairs[0].size)
    const matrices = chairs.map((c) => planTransformMatrix(c.transform))
    const selected = new Set(selection)
    const colorsBySlot = geoms.map(({ slot }) =>
      chairs.map((c) => {
        const col = new THREE.Color(slotColor(entry, c.appearance, slot))
        if (selected.has(c.id)) col.lerp(SELECT_COLOR, 0.55)
        return col
      }),
    )
    const chairIds = chairs.map((c) => c.id)
    return { entry, geoms, matrices, colorsBySlot, chairIds, size: chairs[0].size }
  }, [chairs, selection])

  if (!built) return null

  const procedural = built.geoms.map(({ slot, geometry }, gi) => (
    <ChairSlot
      key={slot}
      geometry={geometry}
      material={instancedChairMaterial()}
      colors={built.colorsBySlot[gi]}
      matrices={built.matrices}
      chairIds={built.chairIds}
      tableId={tableId}
      invalidate={invalidate}
    />
  ))

  if (!built.entry.model) return <>{procedural}</>

  return (
    <ModelFallback fallback={<>{procedural}</>}>
      <ModelChairInstances
        catalogId={built.entry.id}
        url={built.entry.model}
        size={built.size}
        matrices={built.matrices}
        chairIds={built.chairIds}
        tableId={tableId}
        invalidate={invalidate}
      />
    </ModelFallback>
  )
}

/** Chairs of one table drawn from the real GLB — one InstancedMesh per model part. */
function ModelChairInstances({
  catalogId,
  url,
  size,
  matrices,
  chairIds,
  tableId,
  invalidate,
}: {
  catalogId: string
  url: string
  size: Size3D
  matrices: THREE.Matrix4[]
  chairIds: Id[]
  tableId: Id
  invalidate: () => void
}) {
  const parts = useModelParts(catalogId, url, size)
  return (
    <>
      {parts.map(({ key, geometry, material }) => (
        <ChairSlot
          key={key}
          geometry={geometry}
          material={material}
          matrices={matrices}
          chairIds={chairIds}
          tableId={tableId}
          invalidate={invalidate}
        />
      ))}
    </>
  )
}

function ChairSlot({
  geometry,
  material,
  matrices,
  colors,
  chairIds,
  tableId,
  invalidate,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrices: THREE.Matrix4[]
  /** per-instance tint for procedural chairs; omitted for GLB chairs (baked) */
  colors?: THREE.Color[]
  chairIds: Id[]
  tableId: Id
  invalidate: () => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const count = matrices.length
  const placing = useOverlayStore((s) => s.placing)

  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, matrices[i])
      if (colors) mesh.setColorAt(i, colors[i])
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    invalidate()
  }, [matrices, colors, count, invalidate])

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (placing) {
      e.stopPropagation()
      commitPlacement3D(e.point, e.nativeEvent.altKey, tableId)
      return
    }
    e.stopPropagation()
    if (e.instanceId == null) return
    const chairId = chairIds[e.instanceId]
    if (!chairId) return
    // mirror 2D: a chair click selects its TABLE, unless that chair is already selected
    const sel = useEditorStore.getState().selection
    const target = sel.includes(chairId) ? chairId : tableId
    if (e.nativeEvent.shiftKey) toggleSelect(target)
    else select([target])
  }

  const handlePointerMove = placing
    ? (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        previewPlacement3D(e.point, tableId)
      }
    : undefined

  return (
    <instancedMesh
      // key by count so a seating change rebuilds the instance buffers cleanly
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow
      receiveShadow
      onClick={handleClick}
      onPointerMove={handlePointerMove}
    />
  )
}
