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
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { getCatalogEntry } from '../core/catalog/registry'
import { slotColor, type Outline } from '../core/catalog/types'
import { attachedChairs } from '../core/model/seatingReconciler'
import type { Id, Size3D } from '../core/model/types'
import { cmToM } from '../core/space'
import { select } from '../state/actions'
import { isLayerHidden, isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'
import {
  instancedChairMaterial,
  objectSlotGeometries,
  selectedSlotMaterial,
  SELECT_TINT,
  slotMaterial,
} from './meshCache'
import { applyPlanTransform, planTransformMatrix } from './planTransform'
import { useModelParts } from './propModel'

const SELECT_COLOR = new THREE.Color(SELECT_TINT)

export function ObjectGroup({ id }: { id: Id }) {
  const groupRef = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)

  // Per-field selectors: these references are stable across transform-only edits
  // (Immer only clones the path that changed), so a drag never re-renders here.
  const catalogId = useEditorStore((s) => s.scene.objects[id]?.catalogId)
  const size = useEditorStore((s) => s.scene.objects[id]?.size)
  const appearance = useEditorStore((s) => s.scene.objects[id]?.appearance)
  const hasSeating = useEditorStore((s) => !!s.scene.objects[id]?.seating)
  const seatingHidden = useEditorStore((s) => isLayerHidden(s.scene, 'seating'))
  const isSelected = useEditorStore((s) => s.selection.includes(id))

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

  const geometries = useMemo(
    () => (catalogId && size ? objectSlotGeometries(catalogId, size) : []),
    [catalogId, size],
  )

  if (!catalogId || !size || !appearance) return null
  const entry = getCatalogEntry(catalogId)

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    select([id])
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
    <group ref={groupRef} onClick={handleClick}>
      {entry.model ? (
        <ModelFallback fallback={procedural}>
          <ModelParts catalogId={catalogId} url={entry.model} size={size} />
        </ModelFallback>
      ) : (
        procedural
      )}
      {isSelected && <SelectionOutline outline={entry.footprint(size).outline} />}
      {hasSeating && !seatingHidden && <ChairInstances tableId={id} />}
      <SurfaceChildren parentId={id} />
    </group>
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
  const invalidate = useThree((s) => s.invalidate)
  const catalogId = useEditorStore((s) => s.scene.objects[id]?.catalogId)
  const size = useEditorStore((s) => s.scene.objects[id]?.size)
  const appearance = useEditorStore((s) => s.scene.objects[id]?.appearance)
  const isSelected = useEditorStore((s) => s.selection.includes(id))

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
    e.stopPropagation()
    // mirror chairs: a click selects the TABLE, unless this decor is already selected
    const sel = useEditorStore.getState().selection
    select(sel.includes(id) ? [id] : [parentId])
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
    <group ref={groupRef} onClick={handleClick}>
      {entry.model ? (
        <ModelFallback fallback={procedural}>
          <ModelParts catalogId={catalogId} url={entry.model} size={size} />
        </ModelFallback>
      ) : (
        procedural
      )}
      {isSelected && <SelectionOutline outline={entry.footprint(size).outline} />}
    </group>
  )
}

/**
 * The real GLB of a catalog entry. Selection is shown by the floor outline only —
 * baked materials are shared across every instance of the model, so tinting one
 * selected object would tint them all.
 */
function ModelParts({ catalogId, url, size }: { catalogId: string; url: string; size: Size3D }) {
  const parts = useModelParts(catalogId, url, size)
  return (
    <>
      {parts.map(({ key, geometry, material }) => (
        <mesh key={key} geometry={geometry} material={material} castShadow receiveShadow />
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
    e.stopPropagation()
    if (e.instanceId == null) return
    const chairId = chairIds[e.instanceId]
    if (!chairId) return
    // mirror 2D: a chair click selects its TABLE, unless that chair is already selected
    const sel = useEditorStore.getState().selection
    select(sel.includes(chairId) ? [chairId] : [tableId])
  }

  return (
    <instancedMesh
      // key by count so a seating change rebuilds the instance buffers cleanly
      key={count}
      ref={ref}
      args={[geometry, material, count]}
      castShadow
      receiveShadow
      onClick={handleClick}
    />
  )
}
