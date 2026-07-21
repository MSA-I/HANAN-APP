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
import { snapValue } from '../core/layout/snapping'
import { attachedChairs } from '../core/model/seatingReconciler'
import type { Id, Size3D } from '../core/model/types'
import { cmToM, degToRad, radToDeg } from '../core/space'
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

const SELECT_COLOR = new THREE.Color(SELECT_TINT)

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

/** A single-axis editor handle; every drag is one history entry. */
function RotationHandle({ id, object }: { id: Id; object: THREE.Object3D }) {
  const shiftHeld = useOverlayStore((s) => s.shiftHeld)
  const dragging = useRef(false)

  useEffect(
    () => () => {
      if (dragging.current) endGesture()
    },
    [],
  )

  return (
    <TransformControls
      object={object}
      mode="rotate"
      space="world"
      size={0.82}
      showX={false}
      showY
      showZ={false}
      rotationSnap={shiftHeld ? degToRad(15) : null}
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

  // Transient transform sync — the hot path. fireImmediately seeds the initial
  // placement; subsequent drag frames update the matrix without React.
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
    if (placing || e.button !== 0 || e.nativeEvent.shiftKey) return
    const state = useEditorStore.getState()
    const obj = state.scene.objects[id]
    if (!obj || obj.parentId || isEffectivelyLocked(state.scene, obj)) return

    const plane = new THREE.Plane(
      new THREE.Vector3(0, 1, 0),
      -cmToM(obj.transform.elevation),
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
      setPosition(
        id,
        scene.settings.snapEnabled && !event.altKey
          ? { x: snapValue(x, scene.settings.gridSize), y: snapValue(y, scene.settings.gridSize) }
          : { x, y },
      )
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
              color={entry.editableColorSlot ? appearance[entry.editableColorSlot]?.color : undefined}
            />
          </ModelFallback>
        ) : (
          procedural
        )}
        {isSelected && <SelectionOutline outline={entry.footprint(size).outline} />}
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
 */
function ModelParts({
  catalogId,
  url,
  size,
  color,
}: {
  catalogId: string
  url: string
  size: Size3D
  color?: string
}) {
  const parts = useModelParts(catalogId, url, size)
  const tintedMaterials = useMemo(
    () =>
      color
        ? parts.map(({ material }) => {
            const clone = material.clone()
            const tintable = clone as THREE.Material & { color?: THREE.Color }
            if (tintable.color?.isColor) tintable.color.set(color)
            return clone
          })
        : null,
    [color, parts],
  )
  useEffect(
    () => () => {
      tintedMaterials?.forEach((material) => material.dispose())
    },
    [tintedMaterials],
  )
  return (
    <>
      {parts.map(({ key, geometry, material }, index) => (
        <mesh
          key={key}
          geometry={geometry}
          material={tintedMaterials?.[index] ?? material}
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
