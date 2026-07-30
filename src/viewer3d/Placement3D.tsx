import { useEffect, useMemo } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { getCatalogEntry } from '../core/catalog/registry'
import type { CatalogEntry } from '../core/catalog/types'
import { pointInHole, pointInOutline } from '../core/layout/bounds'
import { checkPlacement } from '../core/layout/collision'
import { beamGrid, snapToBeam } from '../core/layout/beams'
import { snapValue } from '../core/layout/snapping'
import { standingHeightAt } from '../core/layout/groundHeight'
import type { Id, SceneState, Vec2 } from '../core/model/types'
import { cmToM, degToRad, threeToPlan } from '../core/space'
import { getVenuePack, type RestrictedZone } from '../core/venuePacks'
import { overlay, useOverlayStore } from '../editor2d/overlayStore'
import { attachesToTable, pickLevelsCm } from './placementTargets'
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

// `attachesToTable` and `pickLevelsCm` moved to ./placementTargets — both decide
// where a click lands, and a rule that lives in a .tsx cannot be tested here
// (AGENT-BRIEF §1.7). Re-exported so `ObjectGroup` reads the predicate from the
// same module it already reads `commitPlacement3D` from.
export { attachesToTable }

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

/** Pointer-only pick surfaces plus the visible footprint preview. */
export function Placement3D() {
  const placing = useOverlayStore((s) => s.placing)
  const ghost = useOverlayStore((s) => s.ghost)
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

  return (
    <>
      <PickSurfaces placing={placing} />
      <PlacementFootprint />
    </>
  )
}

/** Nothing raised in this pack — a stable reference, so the meshes are not rebuilt. */
const NO_ZONES: RestrictedZone[] = []

/**
 * The surfaces the placement ray may land on: ONE PER DECLARED LEVEL, nearest wins.
 *
 * A ceiling fixture gets the single plane at `hangHeight`, because the ray has to
 * cross the height the item will actually hang at or it meets the floor metres away
 * from where the pointer looks (source doc §40, PLAN-04 item ב).
 *
 * Everything else gets the venue floor AND one plane per raised zone, at that
 * zone's own elevation. That is the whole of the reception-deck fix: the deck is at
 * +4.70 m, so a click aimed at it used to be measured on the hall floor and landed
 * metres past x = 6051 → out of bounds → `commitPlacement3D` returned false and the
 * click did nothing, silently. On the resort this is 4 meshes — the hall, the hall
 * ceremony pad (+0.50), the deck (+4.70) and the deck's own canopy pad (+5.20).
 *
 * They nest correctly BY GEOMETRY: R3F reports intersections near to far, so from
 * any camera above them the highest surface over a point is hit first, which is
 * `groundHeightAt`'s "highest declared level wins" restated as meshes
 * (core/layout/groundHeight.ts). No `activeZone`, no whitelist, no special case for
 * the deck — see `pickLevelsCm` for why each of those was rejected.
 *
 * ⚠ The chuppah pad inside the deck stays BLOCKING: a table overlapping it still
 * gets `forbiddenZone: 'chuppah'`. That is 24.3 m² of a 293 m² deck, it is the
 * ceremony pad the user drew himself, and the refusal is now VISIBLE — a red ghost
 * with a violation pill — rather than the dead click it was.
 */
function PickSurfaces({ placing }: { placing: string }) {
  const width = useEditorStore((s) => s.scene.venue.size.width)
  const depth = useEditorStore((s) => s.scene.venue.size.depth)
  const hangHeight = useEditorStore((s) => {
    const pack = getVenuePack(s.scene.venue.venuePackId)
    return pack?.hangHeight ?? s.scene.venue.wallHeight
  })
  // a stable selector, or every frame of a drag would rebuild four meshes
  const zones = useEditorStore(
    useShallow((s) => getVenuePack(s.scene.venue.venuePackId)?.restricted ?? NO_ZONES),
  )
  const ceiling = getCatalogEntry(placing).placement === 'ceiling'
  const levels = useMemo(
    () => (ceiling ? [] : pickLevelsCm({ restricted: zones }, { width, depth })),
    [ceiling, zones, width, depth],
  )

  if (ceiling) {
    return (
      <PickPlane x={0} y={0} width={width} depth={depth} planeY={cmToM(hangHeight)} />
    )
  }
  return (
    <>
      {levels.map((level) => (
        <PickPlane
          key={`${level.x},${level.y},${level.elevationCm}`}
          x={level.x}
          y={level.y}
          width={level.width}
          depth={level.depth}
          // the same 5 mm lift the floor plane always had, so a surface flush with
          // a zone's own top face still wins the depth test against it
          planeY={cmToM(level.elevationCm) + 0.005}
        />
      ))}
    </>
  )
}

/**
 * One invisible horizontal plane over a plan rectangle, listening for the pointer.
 *
 * `stopPropagation` on the MOVE as well as on the click, and it is not symmetry for
 * its own sake: R3F walks every intersection of the ray in order, so without it a
 * preview taken here was overwritten by the next thing the same ray met — another
 * pick plane at a lower level, or an object. `attachesToTable` is the other half of
 * that fix, in `ObjectGroup`.
 */
function PickPlane({
  x,
  y,
  width,
  depth,
  planeY,
}: {
  x: number
  y: number
  width: number
  depth: number
  planeY: number
}) {
  return (
    <mesh
      position={[cmToM(x + width / 2), planeY, cmToM(y + depth / 2)]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation()
        previewPlacement3D(event.point)
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        commitPlacement3D(event.point, event.nativeEvent.altKey)
      }}
    >
      <planeGeometry args={[cmToM(width), cmToM(depth)]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

/**
 * `at` is where the piece is going, and it decides the answer: the reception deck
 * is +4.70, the canopy pad on it +5.20, the one in the hall +0.50. The ghost must
 * agree with where the drop lands, or the preview floats while the object arrives
 * somewhere else — which reads as a worse fault than the one being fixed.
 *
 * Agreement is structural, not a matter of keeping two copies in step: this and
 * ObjectGroup's `baseElevation` are the same core function over the same zone list.
 */
function groundElevation(scene: SceneState, entry: CatalogEntry, at: Vec2): number {
  return standingHeightAt(entry, at, getVenuePack(scene.venue.venuePackId)?.restricted ?? [])
}

function ghostElevation(scene: SceneState, entry: CatalogEntry, point: Vec2): number {
  if (attachesToTable(entry)) {
    const target = tableAt(scene, point)
    if (!target) return 0
    const table = scene.objects[target.id]
    const base =
      groundElevation(scene, getCatalogEntry(table.catalogId), table.transform.position) +
      table.transform.elevation
    // over the open centre of a ring the preview belongs on the floor, which is
    // the only warning the user gets that this drop will not land on the top
    return target.inHole ? base : base + table.size.height
  }
  if (entry.placement === 'ceiling') {
    const pack = getVenuePack(scene.venue.venuePackId)
    return (pack?.hangHeight ?? scene.venue.wallHeight) - entry.defaultSize.height
  }
  return groundElevation(scene, entry, point)
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
