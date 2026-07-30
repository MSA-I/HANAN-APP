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
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/shallow'
import { getCatalogEntry } from '../core/catalog/registry'
import { slotColor, type Outline } from '../core/catalog/types'
import { beamGrid, cordLength, snapToBeam } from '../core/layout/beams'
import { snapValue } from '../core/layout/snapping'
import { standingHeightAt } from '../core/layout/groundHeight'
import { attachedChairs } from '../core/model/seatingReconciler'
import type { Id, SceneState, Size3D } from '../core/model/types'
import { cmToM, relativeTransform, threeToPlan } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { useOverlayStore } from '../editor2d/overlayStore'
import { beginGesture, endGesture, select, setPosition, toggleSelect } from '../state/actions'
import { notify } from '../state/notice'
import {
  designEditTable,
  isArrangeableDecor,
  isDesignEditMuted,
  isEffectivelyLocked,
  isHoverable,
  isLayerHidden,
  isObjectVisible,
  isTable,
} from '../state/selectors'
import { setDesignEditTable, useEditorStore } from '../state/store'
import { strings } from '../ui/strings'
import {
  instancedChairMaterial,
  objectSlotGeometries,
  selectedSlotMaterial,
  SELECT_TINT,
  slotMaterial,
} from './meshCache'
import { applyPlanTransform, planTransformMatrix } from './planTransform'
import { commitPlacement3D, previewPlacement3D } from './Placement3D'
import { RotateHandle } from './RotateHandle'
import { useModelParts } from './propModel'
import { useSlotTextures } from './slotTextures'
import { overrideForPart, slotAppearances, type SlotAppearance } from './appearance'
import { textureUrl } from '../core/catalog/textures'

const SELECT_COLOR = new THREE.Color(SELECT_TINT)

/** No pack, no measured truss to match — the cord stays the near-black it always was. */
const DEFAULT_CORD_COLOR = '#2a2a2a'

/**
 * How far back the rest of the hall falls while one table is being arranged
 * (source doc §52). The same 0.22 as 2D's `DESIGN_EDIT_DIM`
 * (editor2d/ObjectNode.tsx:41) — one mode must not read as two strengths
 * depending on which pane the user happens to be looking at.
 */
const DESIGN_EDIT_DIM = 0.22

/**
 * ⚠ THREE HAS NO GROUP OPACITY. 2D mutes a whole table by dropping the opacity of
 * one Konva group; here the dim is a property of each MATERIAL, so a muted table
 * has to dim its own meshes, its instanced chairs and its surface decor, each
 * explicitly. That is why `muted` is threaded down as a prop instead of being
 * asked of the store in five places.
 *
 * And every material in this file is SHARED: `slotMaterial`/`selectedSlotMaterial`
 * per colour hex, `instancedChairMaterial` a module singleton, and the GLB part
 * materials per catalogId+size in `propModel.partCache`. Writing `opacity` onto
 * one of them would ghost objects nobody asked to dim — the same trap
 * `ModelParts` already avoids by cloning before it tints. So the dim is a CLONE,
 * shared by everything that points at the same source.
 *
 * ponytail: an unbounded Map, bounded in practice by (catalog entries × palette)
 * because only long-lived cached materials are ever handed to it — `ModelParts`
 * dims its own private clones instead, see there. Nothing is disposed, exactly
 * like `sharedGlass` below. If a continuous colour picker ever starts feeding
 * `slotMaterial`, make this an `LruCache` that disposes on eviction, which is how
 * `meshCache` already bounds the materials this mirrors.
 */
const dimmedCache = new Map<string, THREE.Material>()

/** Ghost a material IN PLACE. Only ever called on a clone — never on a cached one. */
function dimInPlace<T extends THREE.Material>(material: T): T {
  material.transparent = true
  material.opacity *= DESIGN_EDIT_DIM
  // Ghosts overlap. Writing depth would let one dimmed table punch a hard-edged
  // hole through another, and nothing behind a ghost is meant to be hidden by it.
  material.depthWrite = false
  return material
}

/** The shared dimmed twin of a shared material, built once per source. */
function dimmedMaterial(source: THREE.Material): THREE.Material {
  const cached = dimmedCache.get(source.uuid)
  if (cached) return cached
  const dimmed = dimInPlace(source.clone())
  dimmedCache.set(source.uuid, dimmed)
  return dimmed
}

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

/**
 * Which table a double-click on `objId` should open for decor editing, or null
 * (source doc §52 — the gesture is the same in BOTH views).
 *
 * Mirrors `onObjectDblClick` / `onChildDblClick` in editor2d/dragController.ts
 * one branch for one branch:
 *
 *   a top-level table   -> open on it
 *   surface decor       -> open on its TABLE; the caller still selects the decor
 *   a chair ('seat')    -> NULL. `kind: 'seat'` keeps meaning "drill into this
 *                          chair", which is the behaviour PLAN-05 builds on
 *   anything else       -> null
 *
 * Duplicated rather than imported on purpose: viewer3d must not depend on
 * editor2d, and A1's version takes a KonvaEventObject. Only the two shared
 * primitives cross over — `isTable` and `setDesignEditTable`, both read-only
 * from A1's files. If this is ever unified, selectors.ts is the home, and both
 * views should move together.
 */
export function designEditTargetOf(scene: SceneState, objId: Id): Id | null {
  const obj = scene.objects[objId]
  if (!obj) return null
  if (!obj.parentId) return isTable(obj) ? obj.id : null
  if (obj.attachment?.kind !== 'surface') return null
  const parent = scene.objects[obj.parentId]
  return parent && !parent.parentId && isTable(parent) ? parent.id : null
}

export function ObjectGroup({ id }: { id: Id }) {
  const groupRef = useRef<THREE.Group>(null)
  const dragRef = useRef<MoveDrag | null>(null)
  const suppressClick = useRef(false)
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
  // Design-edit isolation (source doc §52), the 3D half of what 2D does with one
  // group opacity and `listening={false}` (editor2d/ObjectNode.tsx:152). A
  // BOOLEAN selector: only the mode transition re-renders the hall, never an id
  // change elsewhere. Validated on read via `designEditTable` — the raw store
  // field can still name a table that has been deleted or hidden since.
  const muted = useEditorStore((s) =>
    isDesignEditMuted(designEditTable(s.scene, s.designEditTableId), id),
  )
  const placing = useOverlayStore((s) => s.placing)
  // The surface this piece is standing on, asked of the PLACE it stands in. What
  // used to be here asked the ENTITY — `zoneKind` matched against the zone list —
  // and nothing in the catalogue carries `zoneKind: 'kabalatPanim'`, so a chair on
  // the +4.70 m reception deck was drawn at Y = 0, on the paving outside the
  // building (source doc item 21). The rule, the overlap tie-break and the reason
  // `zoneKind` still wins where it exists are all in core/layout/groundHeight.ts.
  //
  // Still a plain NUMBER, so the selector re-renders only when the level actually
  // changes — which is also what makes a piece dragged onto the deck rise as it
  // crosses the edge and drop again on the way back out.
  const baseElevation = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    if (!obj) return 0
    return standingHeightAt(
      getCatalogEntry(obj.catalogId),
      obj.transform.position,
      getVenuePack(s.scene.venue.venuePackId)?.restricted ?? [],
    )
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
  // Above the early return, like `geometries`: hooks may not sit behind one. The
  // memo is not an optimisation — `ModelParts` disposes and rebuilds its cloned
  // materials whenever this array's identity changes, and `slotAppearances` would
  // hand back a fresh one on every render. `appearance` is immer-stable between
  // edits, so this changes exactly when the user restyles the object.
  const slots = useMemo(
    () => (catalogId && appearance ? slotAppearances(getCatalogEntry(catalogId), appearance) : []),
    [catalogId, appearance],
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

  /**
   * Double-click a table to isolate it for decor editing — the 3D half of the
   * gesture 2D already had (source doc §52). Without it the mode could only be
   * entered from the plan, which is not what "double-click in both views" means.
   *
   * No `select` here: the pointer-down that precedes every double-click has
   * already selected this object, exactly as 2D's mousedown does.
   */
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    // an armed ghost owns the gesture; the two clicks under it are placements
    if (placing) return
    e.stopPropagation()
    const target = designEditTargetOf(useEditorStore.getState().scene, id)
    if (target) setDesignEditTable(target)
  }

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    suppressClick.current = false
    if (placing || e.button !== 0 || e.nativeEvent.shiftKey) return
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

  /**
   * The `move` cursor over anything the pointer may actually pick up — the 3D
   * half of the affordance the plan has had all along.
   *
   * It asks `isHoverable`, the SAME selector `editor2d` asks, rather than
   * re-deriving "visible and unlocked and not muted" here: a hover promise the
   * plan makes and the viewer does not is how the same locked chandelier ends up
   * looking grabbable in one pane and inert in the other.
   *
   * Cursor only — no new geometry, no highlight material, nothing added to the
   * 2,700-draw-call floor. The group already carries `onPointerMove`, so R3F is
   * raycasting this object either way and the events are free.
   */
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (placing || dragRef.current) return
    e.stopPropagation()
    const state = useEditorStore.getState()
    if (!isHoverable(state.scene, id, state.designEditTableId)) return
    gl.domElement.style.cursor = 'move'
  }

  const handlePointerOut = () => {
    // a drag owns the cursor ('grabbing') until it ends and restores it itself
    if (dragRef.current) return
    gl.domElement.style.cursor = ''
  }

  const procedural = geometries.map(({ slot, geometry }) => {
    const color = slotColor(entry, appearance, slot)
    const material = isSelected ? selectedSlotMaterial(color) : slotMaterial(color)
    return (
      <mesh
        key={slot}
        geometry={geometry}
        material={muted ? dimmedMaterial(material) : material}
        // A ghosted table that still lays a solid shadow on the floor reads as a
        // rendering fault rather than as a table the mode is standing down.
        castShadow={!muted}
        receiveShadow
      />
    )
  })

  return (
    <>
      <group
        ref={groupRef}
        // Muted means OUT of the session, not merely faint: 2D takes `listening`
        // away from the same objects, so leaving these attached would let a user
        // in 3D select, drag and even open the mode on a table the plan will not
        // let them touch. With no handler the ray carries on to whatever is
        // behind, exactly as a click through a non-listening Konva group does.
        onClick={muted ? undefined : handleClick}
        onDoubleClick={muted ? undefined : handleDoubleClick}
        onPointerDown={muted ? undefined : handlePointerDown}
        onPointerMove={muted ? undefined : handlePointerMove}
        onPointerOver={muted ? undefined : handlePointerOver}
        onPointerOut={muted ? undefined : handlePointerOut}
      >
        {entry.model ? (
          <ModelFallback fallback={procedural}>
            <ModelParts
              catalogId={catalogId}
              url={entry.model}
              size={size}
              slots={slots}
              muted={muted}
            />
          </ModelFallback>
        ) : (
          procedural
        )}
        {isSelected && !muted && <SelectionOutline outline={entry.footprint(size).outline} />}
        {drop > 0 && <HangingCord from={size.height} length={drop} color={cordColor} muted={muted} />}
        {hasSeating && !seatingHidden && <ChairInstances tableId={id} muted={muted} />}
        <SurfaceChildren parentId={id} muted={muted} />
        {/* INSIDE the group, unlike the gizmo it replaces. That is what lets the
            band's own `stopPropagation()` block the floor-drag underneath it —
            R3F bubbles up the object tree — and it means the band inherits the
            table's heading for free instead of being re-placed every frame. */}
        {canRotate && !muted && !placing && (
          <RotateHandle
            id={id}
            outline={entry.footprint(size).outline}
            heightCm={size.height}
          />
        )}
      </group>
    </>
  )
}

/** Decor standing on this object's top — each child in its own local group. */
function SurfaceChildren({ parentId, muted }: { parentId: Id; muted: boolean }) {
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
        <SurfaceChild key={id} id={id} parentId={parentId} muted={muted} />
      ))}
    </>
  )
}

/**
 * One surface decor. Mirrors ObjectGroup's shape (transient transform, GLB with
 * procedural fallback) but lives INSIDE the parent's group, so its transform is
 * parent-local with elevation = the parent's height (set by the actions layer).
 *
 * It is DRAGGABLE ONLY IN DESIGN-EDIT MODE (source doc §11 + §52). Outside the
 * mode a press falls through to `handleClick`, which retargets the selection to
 * the table exactly as it always did — decor that moved on every stray drag of a
 * table would be worse than decor that cannot be moved at all.
 */
function SurfaceChild({ id, parentId, muted }: { id: Id; parentId: Id; muted: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const dragRef = useRef<MoveDrag | null>(null)
  const suppressClick = useRef(false)
  const invalidate = useThree((s) => s.invalidate)
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const catalogId = useEditorStore((s) => s.scene.objects[id]?.catalogId)
  const size = useEditorStore((s) => s.scene.objects[id]?.size)
  const appearance = useEditorStore((s) => s.scene.objects[id]?.appearance)
  const isSelected = useEditorStore((s) => s.selection.includes(id))
  const canRotate = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    return s.selection.length === 1 && s.selection[0] === id && !!obj && !isEffectivelyLocked(s.scene, obj)
  })
  // A BOOLEAN selector, so it re-renders on entering/leaving the mode and never
  // on an id change elsewhere. Validated on read via A1's `designEditTable` — the
  // raw store field can name a table that has since been deleted or hidden.
  const inEditSession = useEditorStore(
    (s) => designEditTable(s.scene, s.designEditTableId) === parentId,
  )
  // …and separately, whether this particular piece may be moved at all. The COVER
  // may not (source doc §11) — see `isArrangeableDecor`, which editor2d/ObjectNode
  // asks of the same object so the plan and the render cannot disagree. Split in
  // two rather than folded into one flag because the mode still being OPEN is what
  // turns a refused press into a message instead of a dead pointer.
  const arrangeable = useEditorStore((s) => {
    const obj = s.scene.objects[id]
    return !!obj && isArrangeableDecor(obj)
  })
  const editable = inEditSession && arrangeable
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
  // Above the early return, like `geometries`: hooks may not sit behind one. The
  // memo is not an optimisation — `ModelParts` disposes and rebuilds its cloned
  // materials whenever this array's identity changes, and `slotAppearances` would
  // hand back a fresh one on every render. `appearance` is immer-stable between
  // edits, so this changes exactly when the user restyles the object.
  const slots = useMemo(
    () => (catalogId && appearance ? slotAppearances(getCatalogEntry(catalogId), appearance) : []),
    [catalogId, appearance],
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
      commitPlacement3D(e.point, e.nativeEvent.altKey, parentId)
      return
    }
    e.stopPropagation()
    // mirror chairs: a click selects the TABLE, unless this decor is already
    // selected — or unless the mode that exists to edit these pieces is open, in
    // which case the piece IS the thing being clicked (source doc §11).
    // `inEditSession`, not `editable`: a cover cannot be MOVED, but selecting one
    // to read it in the inspector was never what §11 refused.
    const sel = useEditorStore.getState().selection
    const target = inEditSession || sel.includes(id) ? id : parentId
    if (e.nativeEvent.shiftKey) toggleSelect(target)
    else select([target])
  }

  /**
   * Decor opens the mode on its PARENT and stays selected, ready to drag —
   * A1's reasoning in `onChildDblClick`, and it matters more in 3D than in 2D:
   * every `placement: 'surface'` entry is `surfaceAnchor: 'center'`
   * (06-collision-api §3.1), so a hand-placed centrepiece sits dead on the
   * middle of the table and IS the biggest target on it. Aiming there and
   * getting nothing is the first thing a user tries.
   *
   * `stopPropagation` is load-bearing: this group is INSIDE the table's, so
   * without it the table's own handler would fire too. It is `e.cancelBubble`
   * in the 2D twin.
   */
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (placing) return
    e.stopPropagation()
    const target = designEditTargetOf(useEditorStore.getState().scene, id)
    if (target) setDesignEditTable(target)
    select([id])
  }

  /**
   * Drag this piece across its parent's top. Only inside design-edit mode, and
   * only for this parent's session.
   *
   * The plane is the child's OWN elevation, taken from the group's world position
   * — the group sits inside the parent's, so that one read already carries the
   * parent's transform, the zone base elevation and the child's stacking height.
   *
   * `setPosition` wants the object's own frame, which for a child is PARENT-LOCAL
   * (model/types.ts:5-9), so the plan-space hit is put through
   * `relativeTransform`. That is also the frame `checkPlacement` judges a child in
   * (`parentLocal`, 06-collision-api §2), so the sibling check and `slideToLegal`
   * come along for free — the same red-outline feedback the 2D drag gets.
   *
   * No grid snap, deliberately: the venue grid is world-aligned and the offsets
   * here are measured from the middle of a table that may be turned to any angle,
   * so snapping would quantise to lines that mean nothing on this top. A1's 2D
   * child drag snaps nothing either, and the two views must agree.
   */
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    suppressClick.current = false
    if (placing || e.button !== 0 || e.nativeEvent.shiftKey) return
    if (!editable) {
      // Inside the session the only piece that gets here is the cover, and a
      // refusal nobody can see is indistinguishable from a broken drag. The event
      // is NOT stopped: it carries on to the table's own handler, so pressing a
      // place setting moves the table exactly as pressing a chair does — the 2D
      // twin of this line does the same (editor2d/ObjectNode.tsx).
      if (inEditSession) notify(strings.editMode.placeSettingLocked)
      return
    }
    const state = useEditorStore.getState()
    const obj = state.scene.objects[id]
    const group = groupRef.current
    if (!obj || !group || isEffectivelyLocked(state.scene, obj)) return

    const world = group.getWorldPosition(new THREE.Vector3())
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -world.y)
    const hit = new THREE.Vector3()
    if (!e.ray.intersectPlane(plane, hit)) return
    const capture = e.nativeEvent.target
    if (!(capture instanceof Element)) return

    /** plan-space hit -> the parent's local frame, the frame `setPosition` writes. */
    const toLocal = (point: THREE.Vector3) => {
      const parent = useEditorStore.getState().scene.objects[parentId]
      const plan = threeToPlan(point.x, point.z)
      if (!parent) return plan
      return relativeTransform(parent.transform, {
        position: plan,
        rotation: 0,
        elevation: 0,
      }).position
    }

    e.stopPropagation()
    if (state.selection.length !== 1 || state.selection[0] !== id) select([id])
    const grabbed = toLocal(hit)
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const drag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: obj.transform.position.x - grabbed.x,
      offsetY: obj.transform.position.y - grabbed.y,
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
      const local = toLocal(drag.hit)
      setPosition(id, { x: local.x + drag.offsetX, y: local.y + drag.offsetY })
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

  const handlePointerMove = placing
    ? (e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation()
        previewPlacement3D(e.point, parentId)
      }
    : undefined

  const procedural = geometries.map(({ slot, geometry }) => {
    const color = slotColor(entry, appearance, slot)
    const material = isSelected ? selectedSlotMaterial(color) : slotMaterial(color)
    return (
      <mesh
        key={slot}
        geometry={geometry}
        material={muted ? dimmedMaterial(material) : material}
        castShadow={!muted}
        receiveShadow
      />
    )
  })

  return (
    <>
      <group
        ref={groupRef}
        // `muted` is the TABLE's — the whole group stands down together, decor
        // included, or a ghosted table would still hand out its centrepieces.
        onClick={muted ? undefined : handleClick}
        onDoubleClick={muted ? undefined : handleDoubleClick}
        onPointerDown={muted ? undefined : handlePointerDown}
        onPointerMove={muted ? undefined : handlePointerMove}
      >
        {entry.model ? (
          <ModelFallback fallback={procedural}>
            <ModelParts
              catalogId={catalogId}
              url={entry.model}
              size={size}
              slots={slots}
              muted={muted}
            />
          </ModelFallback>
        ) : (
          procedural
        )}
        {isSelected && !muted && <SelectionOutline outline={entry.footprint(size).outline} />}
        {/* A decor item's band sits in ITS group, so it hugs the centrepiece
            rather than the table under it. `baseElevationCm` is 0 because a
            surface child's transform is already parent-local — the actions layer
            sets its elevation to the table's height. */}
        {canRotate && !muted && !placing && (
          <RotateHandle
            id={id}
            outline={entry.footprint(size).outline}
            heightCm={size.height}
          />
        )}
      </group>
    </>
  )
}

/**
 * Which parts are glass, and what glass looks like.
 *
 * The marker is the material NAME, written into the GLB by
 * `tools/glb-prep/mark-glass.mjs`. Nothing in a Tripo export says "glass": the 81
 * parts of a place setting are all called `Material_tripo_part_<n>` and all
 * declare the same opaque metal (Plans/R3/handoff/BLOCKED-05-A3.md). The prep
 * step finds the two vessels by their geometry and renames them, which is a
 * marking that survives re-prepping the same source — an index list would not.
 *
 * `transmission` costs a second render pass per frame, which is why this is
 * built only for the parts that need it and never as a default.
 */
const isGlassPart = (material: THREE.Material) => material.name.startsWith('glass')

/**
 * ONE material for every glass on every table — glass carries no per-object state
 * (no tint, no texture, no size), so a second instance would be a second shader
 * upload for an identical surface. A 22-cover table alone would otherwise build
 * 44. It is never disposed, which is why the cleanup below has to skip it.
 */
let sharedGlass: THREE.MeshPhysicalMaterial | null = null
const glassMaterial = () =>
  (sharedGlass ??= new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    metalness: 0,
    roughness: 0.05,
    transmission: 0.95,
    thickness: 0.5,
    ior: 1.5,
    transparent: true,
  }))

/**
 * The real GLB of a catalog entry. An editable appearance override gets private
 * cloned materials, keeping the baked maps and PBR data intact without touching
 * other instances.
 *
 * An override is a tint, a `map`, or both, and it reaches only the parts its slot
 * OWNS — `overrideForPart` matches the GLB material name against the slot's
 * `match` prefix. That is what lets the divider's curtain change while its frame
 * stays black. Both are written to the CLONE; the cached material in
 * `propModel.partCache` is never touched, so no cache key has to carry the
 * texture (BRIEF §1.8).
 */
function ModelParts({
  catalogId,
  url,
  size,
  slots,
  muted,
}: {
  catalogId: string
  url: string
  size: Size3D
  /** what each editable slot is asking for; `[]` for an entry with none */
  slots: SlotAppearance[]
  /** design-edit mode is arranging another table — ghost this one (source doc §52) */
  muted?: boolean
}) {
  const parts = useModelParts(catalogId, url, size)
  const invalidate = useThree((s) => s.invalidate)
  const maps = useSlotTextures(
    useMemo(() => slots.map((s) => (s.textureId ? textureUrl(s.textureId) : undefined)), [slots]),
  )
  const hasGlass = useMemo(() => parts.some((p) => isGlassPart(p.material)), [parts])
  // ⚠ The dim is folded in HERE rather than through `dimmedMaterial`, because the
  // materials in this array are this component's OWN clones: the cache up top may
  // only be keyed on long-lived shared materials, and feeding it a per-instance
  // clone would grow it without bound and hand back a dimmed twin of a material
  // that has since been disposed. `muted` is a memo dependency, so leaving the
  // mode rebuilds these undimmed.
  //
  // ⚠⚠ `null` FOR A PART MEANS "USE THE CACHED ORIGINAL", and it is the reason
  // this array is nullable per entry rather than dense. `propModel.partCache`
  // materials belong to drei's `useGLTF` cache and are SHARED across every instance
  // and every size of that entry — so putting an unmatched part's own material into
  // this array would make the cleanup below dispose it, and unmounting one divider
  // would black out every other object built from the same GLB. Far from the cause,
  // and only after a delete. The render line reads `overridden?.[i] ?? material`,
  // which turns the sentinel back into exactly that shared material without ever
  // taking ownership of it.
  const overriddenMaterials = useMemo(() => {
    const styled = slots.some((s, i) => s.color || maps[i])
    if (!styled && !hasGlass && !muted) return null
    return parts.map(({ material }) => {
      // A drinking vessel is not a tint of the mesh it was cut from — it is a
      // different material class. The baked one is `metalness 1, roughness 1,
      // OPAQUE`, and cloning it can never become glass: `transmission` lives on
      // MeshPhysicalMaterial and the clone is Standard. So this one is BUILT,
      // and the part's own baked texture is dropped on purpose — a transmissive
      // surface has nothing to show it on.
      //
      // Muted, it has to be a COPY of that one: `sharedGlass` is every glass on
      // every table, so ghosting it in place would ghost the whole hall.
      if (isGlassPart(material)) {
        return muted ? dimInPlace(glassMaterial().clone()) : glassMaterial()
      }
      const own = overrideForPart(material.name, slots)
      const color = own?.color
      const map = own ? maps[slots.indexOf(own)] : null
      // nothing to say about this part: the sentinel, NOT `material`
      if (!color && !map && !muted) return null
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
      if (muted) dimInPlace(clone)
      return clone
    })
  }, [slots, maps, hasGlass, muted, parts])
  // frameloop is "demand": a texture that arrives after the object was drawn has
  // to ask for the frame that shows it
  useEffect(() => invalidate(), [overriddenMaterials, invalidate])
  useEffect(
    () => () => {
      // Everything disposed here is ours and nothing else is. Three exclusions, and
      // each names a different owner: `null` is a part still wearing the SHARED
      // cached material from `propModel.partCache`; `sharedGlass` is the one glass
      // material every table's glasses point at, which is never disposed at all; and
      // what is left can only be a `.clone()` made a few lines above. The texture is
      // shared per URL and outlives all of them.
      overriddenMaterials?.forEach((material) => {
        if (material && material !== sharedGlass) material.dispose()
      })
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
          // muted ⇒ `overriddenMaterials` is always built, so the mesh above is
          // already the ghost; the shadow is the other half of not being there
          castShadow={!muted}
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
function HangingCord({
  from,
  length,
  color,
  muted,
}: {
  from: number
  length: number
  color: string
  muted?: boolean
}) {
  return (
    <mesh position={[0, cmToM(from + length / 2), 0]} raycast={() => null} castShadow={!muted}>
      <cylinderGeometry args={[cmToM(1.5), cmToM(1.5), cmToM(length), 6]} />
      {/* This material is inline and private to this fixture, so the mute is set
          on it directly — `dimmedMaterial`'s cache is for the shared ones. A
          solid wire hanging out of a ghosted chandelier is the giveaway that a
          dim was applied per mesh and one was missed. */}
      <meshStandardMaterial
        color={color}
        metalness={0.5}
        roughness={0.5}
        transparent={muted}
        opacity={muted ? DESIGN_EDIT_DIM : 1}
        depthWrite={!muted}
      />
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
function ChairInstances({ tableId, muted }: { tableId: Id; muted: boolean }) {
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
      muted={muted}
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
        muted={muted}
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
  muted,
}: {
  catalogId: string
  url: string
  size: Size3D
  matrices: THREE.Matrix4[]
  chairIds: Id[]
  tableId: Id
  invalidate: () => void
  muted: boolean
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
          muted={muted}
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
  muted,
}: {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrices: THREE.Matrix4[]
  /** per-instance tint for procedural chairs; omitted for GLB chairs (baked) */
  colors?: THREE.Color[]
  chairIds: Id[]
  tableId: Id
  invalidate: () => void
  /** the table these chairs ride is dimmed — they are part of it, so they go too */
  muted: boolean
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

  /**
   * ⚠ THIS HANDLER EXISTS TO *STOP* SOMETHING, and removing it is a silent bug.
   *
   * The chairs are instanced INSIDE the table's group, so R3F resolves a hit on
   * a chair to the nearest ancestor carrying the handler — the table's group.
   * With no `onDoubleClick` here, double-clicking a CHAIR would open design-edit
   * mode on its table, which is not what 2D does and not what the mode is for.
   *
   * What it does instead is the 2D behaviour: drill into the chair and select
   * it. `designEditTargetOf` returns null for a `kind: 'seat'` child, so the
   * mode is left alone; the call is kept rather than dropped so the rule stays
   * in one place and a future seat-like child cannot quietly diverge.
   */
  const handleDoubleClick = (e: ThreeEvent<MouseEvent>) => {
    if (placing) return
    e.stopPropagation()
    if (e.instanceId == null) return
    const chairId = chairIds[e.instanceId]
    if (!chairId) return
    const target = designEditTargetOf(useEditorStore.getState().scene, chairId)
    if (target) setDesignEditTable(target)
    select([chairId])
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
      // ⚠ `args` keeps the UNDIMMED material on purpose: R3F re-CONSTRUCTS the
      // instanced mesh whenever `args` change, and the layout effect above would
      // not re-run for it (its deps did not change), leaving every chair stacked
      // at the origin. As a plain prop the swap is applied to the existing mesh.
      args={[geometry, material, count]}
      material={muted ? dimmedMaterial(material) : material}
      castShadow={!muted}
      receiveShadow
      onClick={muted ? undefined : handleClick}
      onDoubleClick={muted ? undefined : handleDoubleClick}
      onPointerMove={muted ? undefined : handlePointerMove}
    />
  )
}
