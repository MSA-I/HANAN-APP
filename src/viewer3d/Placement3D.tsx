import { useEffect } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { getCatalogEntry } from '../core/catalog/registry'
import type { CatalogEntry } from '../core/catalog/types'
import { outlineAABB, pointInOutline } from '../core/layout/bounds'
import { snapValue } from '../core/layout/snapping'
import type { Id, SceneState, Vec2 } from '../core/model/types'
import { cmToM, degToRad, threeToPlan } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import {
  addObject,
  addObjectToSurface,
  addSeatItemsToTable,
  addTablePreset,
  select,
} from '../state/actions'
import { isEffectivelyLocked, isObjectVisible } from '../state/selectors'
import { useEditorStore } from '../state/store'

const VALID = '#1f8a50'
const INVALID = '#d64545'

const attachesToTable = (entry: CatalogEntry): boolean =>
  entry.placement === 'surface' || entry.placement === 'seat'

function tableAt(scene: SceneState, point: Vec2, preferred?: Id): Id | null {
  const ordered = [...scene.objectOrder].reverse()
  const ids = preferred ? [preferred, ...ordered.filter((id) => id !== preferred)] : ordered
  for (const id of ids) {
    const obj = scene.objects[id]
    if (!obj || obj.parentId || !isObjectVisible(scene, id) || isEffectivelyLocked(scene, obj)) continue
    const entry = getCatalogEntry(obj.catalogId)
    if (entry.category !== 'tables') continue
    if (pointInOutline(point, obj.transform, entry.footprint(obj.size).outline)) return id
  }
  return null
}

interface PlacementPoint {
  entry: CatalogEntry
  point: Vec2
  target: Id | null
  valid: boolean
}

function resolvePlacement(point: Vec2, preferred?: Id): PlacementPoint | null {
  const catalogId = useOverlayStore.getState().placing
  if (!catalogId) return null
  const scene = useEditorStore.getState().scene
  const entry = getCatalogEntry(catalogId)
  const attached = attachesToTable(entry)
  const snapped =
    !attached && scene.settings.snapEnabled
      ? {
          x: snapValue(point.x, scene.settings.gridSize),
          y: snapValue(point.y, scene.settings.gridSize),
        }
      : point
  const target = attached ? tableAt(scene, snapped, preferred) : null
  if (attached) {
    const table = target ? scene.objects[target] : null
    return {
      entry,
      point: snapped,
      target,
      valid: !!table && (entry.placement !== 'seat' || !!table.seating),
    }
  }

  const box = outlineAABB(
    {
      position: snapped,
      rotation: entry.defaultRotation ?? 0,
      elevation: 0,
    },
    entry.footprint(entry.defaultSize).outline,
  )
  const { width, depth } = scene.venue.size
  return {
    entry,
    point: snapped,
    target: null,
    valid: box.minX >= 0 && box.minY >= 0 && box.maxX <= width && box.maxY <= depth,
  }
}

export function previewPlacement3D(point: Pick<THREE.Vector3, 'x' | 'z'>, preferred?: Id): void {
  const resolved = resolvePlacement(threeToPlan(point.x, point.z), preferred)
  overlay.setGhost(
    resolved
      ? { x: resolved.point.x, y: resolved.point.y, valid: resolved.valid }
      : null,
  )
}

export function commitPlacement3D(
  point: Pick<THREE.Vector3, 'x' | 'z'>,
  keepPlacing: boolean,
  preferred?: Id,
): boolean {
  const resolved = resolvePlacement(threeToPlan(point.x, point.z), preferred)
  if (!resolved?.valid) return false

  const preset = useOverlayStore.getState().placingPreset
  if (resolved.entry.placement === 'surface' && resolved.target) {
    addObjectToSurface(resolved.entry.id, resolved.target, resolved.point)
  } else if (resolved.entry.placement === 'seat' && resolved.target) {
    const ids = addSeatItemsToTable(resolved.entry.id, resolved.target)
    if (ids.length) select(ids)
  } else if (preset) {
    addTablePreset(preset, resolved.point)
  } else {
    addObject(resolved.entry.id, resolved.point)
  }

  if (!keepPlacing) overlay.setPlacing(null)
  return true
}

/** Pointer-only venue plane plus the visible footprint preview. */
export function Placement3D() {
  const placing = useOverlayStore((s) => s.placing)
  const ghost = useOverlayStore((s) => s.ghost)
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    if (!placing) return
    const previous = gl.domElement.style.cursor
    gl.domElement.style.cursor = ghost?.valid === false ? 'not-allowed' : 'copy'
    return () => {
      gl.domElement.style.cursor = previous
    }
  }, [gl, placing, ghost?.valid])

  if (!placing) return null

  const onMove = (event: ThreeEvent<PointerEvent>) => {
    previewPlacement3D(event.point)
  }
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    commitPlacement3D(event.point, event.nativeEvent.altKey)
  }

  return (
    <>
      <mesh
        position={[cmToM(width) / 2, 0.005, cmToM(depth) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={onMove}
        onClick={onClick}
      >
        <planeGeometry args={[cmToM(width), cmToM(depth)]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <PlacementFootprint />
    </>
  )
}

function zoneElevation(scene: SceneState, entry: CatalogEntry): number {
  if (!entry.zoneKind) return 0
  const zone = getVenuePack(scene.venue.venuePackId)?.restricted?.find(
    (candidate) => candidate.kind === entry.zoneKind,
  )
  return zone && 'elevation' in zone && typeof zone.elevation === 'number' ? zone.elevation : 0
}

function ghostElevation(scene: SceneState, entry: CatalogEntry, point: Vec2): number {
  if (attachesToTable(entry)) {
    const target = tableAt(scene, point)
    if (!target) return 0
    const table = scene.objects[target]
    return zoneElevation(scene, getCatalogEntry(table.catalogId)) + table.transform.elevation + table.size.height
  }
  if (entry.placement === 'ceiling') {
    const pack = getVenuePack(scene.venue.venuePackId)
    return (pack?.hangHeight ?? scene.venue.wallHeight) - entry.defaultSize.height
  }
  return zoneElevation(scene, entry)
}

function PlacementFootprint() {
  const placing = useOverlayStore((s) => s.placing)
  const ghost = useOverlayStore((s) => s.ghost)
  const scene = useEditorStore((s) => s.scene)
  if (!placing || !ghost) return null

  const entry = getCatalogEntry(placing)
  const outline = entry.footprint(entry.defaultSize).outline
  const elevation = ghostElevation(scene, entry, ghost)
  const color = ghost.valid ? VALID : INVALID

  return (
    <group
      position={[cmToM(ghost.x), cmToM(elevation) + 0.025, cmToM(ghost.y)]}
      rotation={[0, -degToRad(entry.defaultRotation ?? 0), 0]}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} renderOrder={20}>
        {outline.kind === 'circle' ? (
          <circleGeometry args={[cmToM(outline.r), 48]} />
        ) : (
          <planeGeometry args={[cmToM(outline.w), cmToM(outline.h)]} />
        )}
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.28}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  )
}
