import { useEffect } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { getCatalogEntry } from '../core/catalog/registry'
import type { CatalogEntry } from '../core/catalog/types'
import { pointInHole, pointInOutline } from '../core/layout/bounds'
import { checkPlacement } from '../core/layout/collision'
import { beamGrid, snapToBeam } from '../core/layout/beams'
import { snapValue } from '../core/layout/snapping'
import { zoneUnder } from '../core/layout/zoneOccupancy'
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

/**
 * `inHole` reports a point over the open centre of a ring table, where the piece
 * stands on the floor and rises through it rather than sitting on the top
 * (source doc §48). Mirrors Stage2D.surfaceTargetAt so a drop lands the same way
 * in either view.
 */
function tableAt(
  scene: SceneState,
  point: Vec2,
  preferred?: Id,
): { id: Id; inHole: boolean } | null {
  const ordered = [...scene.objectOrder].reverse()
  const ids = preferred ? [preferred, ...ordered.filter((id) => id !== preferred)] : ordered
  for (const id of ids) {
    const obj = scene.objects[id]
    if (!obj || obj.parentId || !isObjectVisible(scene, id) || isEffectivelyLocked(scene, obj)) continue
    const entry = getCatalogEntry(obj.catalogId)
    if (entry.category !== 'tables') continue
    const outline = entry.footprint(obj.size).outline
    if (pointInOutline(point, obj.transform, outline)) {
      return { id, inHole: pointInHole(point, obj.transform, outline) }
    }
  }
  return null
}

interface PlacementPoint {
  entry: CatalogEntry
  point: Vec2
  target: { id: Id; inHole: boolean } | null
  valid: boolean
}

function resolvePlacement(point: Vec2, preferred?: Id): PlacementPoint | null {
  const catalogId = useOverlayStore.getState().placing
  if (!catalogId) return null
  const scene = useEditorStore.getState().scene
  const entry = getCatalogEntry(catalogId)
  const attached = attachesToTable(entry)
  // A ceiling fixture rides the truss grid, not the floor grid (source doc §12).
  // `factory.createObject` already snaps the COMMITTED position that way, so the
  // ghost has to agree or it promises a spot the drop will not use.
  const snapped =
    entry.placement === 'ceiling'
      ? snapToBeam(point, beamGrid(getVenuePack(scene.venue.venuePackId), scene.venue.size))
      : !attached && scene.settings.snapEnabled
        ? {
            x: snapValue(point.x, scene.settings.gridSize),
            y: snapValue(point.y, scene.settings.gridSize),
          }
        : point
  const target = attached ? tableAt(scene, snapped, preferred) : null
  const table = target ? scene.objects[target.id] : null
  if (attached && (!table || (entry.placement === 'seat' && !table.seating))) {
    overlay.setViolation(null) // "not over a usable table" is a cursor state, not a refusal
    return { entry, point: snapped, target, valid: false }
  }

  // the same question the drop asks, so the preview cannot promise what the
  // placement will refuse (source doc §57) — this used to test the venue
  // rectangle only, which left the ghost green over the pool
  const violations = checkPlacement(scene, {
    catalogId: entry.id,
    transform: { position: snapped, rotation: entry.defaultRotation ?? 0, elevation: 0 },
    size: entry.defaultSize,
    parentId: target?.id,
  })
  overlay.setViolation(violations[0] ?? null)
  return { entry, point: snapped, target, valid: violations.length === 0 }
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
    addObjectToSurface(
      resolved.entry.id,
      resolved.target.id,
      resolved.point,
      resolved.target.inHole,
    )
  } else if (resolved.entry.placement === 'seat' && resolved.target) {
    const ids = addSeatItemsToTable(resolved.entry.id, resolved.target.id)
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
  const hangHeight = useEditorStore((s) => {
    const pack = getVenuePack(s.scene.venue.venuePackId)
    return pack?.hangHeight ?? s.scene.venue.wallHeight
  })
  // The pick plane has to sit at the height the item will actually hang at, or
  // the ray crosses the floor metres away from where the pointer looks — which
  // is why hanging a chandelier in 3D does not work today (source doc §40).
  // From PLAN-04 via handoff/04-ceiling-placement.diff, item (ב).
  const ceiling = placing ? getCatalogEntry(placing).placement === 'ceiling' : false
  const planeY = ceiling ? cmToM(hangHeight) : 0.005
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
        position={[cmToM(width) / 2, planeY, cmToM(depth) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={onMove}
        onClick={onClick}
      >
        <planeGeometry args={[cmToM(width), cmToM(depth)]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <PlacementFootprint />
    </>
  )
}

/**
 * `at` is where the piece is going, and it decides WHICH rectangle of the family
 * answers: a chuppah has one pad in the hall (+0.50) and one on the reception deck
 * (+5.20). The ghost must agree with where the drop lands, or the preview floats
 * and the object arrives somewhere else — which reads as a worse fault than the
 * one being fixed.
 */
function zoneElevation(scene: SceneState, entry: CatalogEntry, at: Vec2): number {
  if (!entry.zoneKind) return 0
  const family =
    getVenuePack(scene.venue.venuePackId)?.restricted?.filter((z) => z.kind === entry.zoneKind) ?? []
  return zoneUnder(family, at)?.elevation ?? 0
}

function ghostElevation(scene: SceneState, entry: CatalogEntry, point: Vec2): number {
  if (attachesToTable(entry)) {
    const target = tableAt(scene, point)
    if (!target) return 0
    const table = scene.objects[target.id]
    const base =
      zoneElevation(scene, getCatalogEntry(table.catalogId), table.transform.position) +
      table.transform.elevation
    // over the open centre of a ring the preview belongs on the floor, which is
    // the only warning the user gets that this drop will not land on the top
    return target.inHole ? base : base + table.size.height
  }
  if (entry.placement === 'ceiling') {
    const pack = getVenuePack(scene.venue.venuePackId)
    return (pack?.hangHeight ?? scene.venue.wallHeight) - entry.defaultSize.height
  }
  return zoneElevation(scene, entry, point)
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
    <>
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
      {entry.placement === 'ceiling' && (
        <DropLine x={ghost.x} y={ghost.y} top={elevation} color={color} />
      )}
    </>
  )
}

/**
 * Plumb line from a ceiling ghost down to the floor. Without it the disc floats
 * 8m up with nothing tying it to a plan position, and the user cannot tell which
 * table the chandelier will end up over.
 * From PLAN-04 via handoff/04-ceiling-placement.diff, item (ג).
 */
function DropLine({ x, y, top, color }: { x: number; y: number; top: number; color: string }) {
  return (
    <mesh position={[cmToM(x), cmToM(top) / 2, cmToM(y)]} raycast={() => null} renderOrder={20}>
      <cylinderGeometry args={[0.02, 0.02, cmToM(top), 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.45} depthWrite={false} />
    </mesh>
  )
}
