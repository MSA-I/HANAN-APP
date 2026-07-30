/**
 * The name badge pinned over the selected table.
 *
 * WHY IT EXISTS. `SelectionBar3D` is a fixed strip at the bottom of the screen,
 * so on a floor of forty tables it cannot say WHICH one the seat stepper is
 * about to add a chair to. The badge is the missing half of that control: the
 * bar acts, the badge says on what.
 *
 * ONE DOM NODE, single selection only, `pointerEvents: 'none'`. It must never
 * eat a click — the whole surface under it is the table the user is trying to
 * drag.
 *
 * ⚠ drei's `<Html>` was UNUSED IN THIS REPO before this file, so its behaviour
 * under `frameloop="demand"` was unproven. Two things are true of it and both
 * matter here:
 *
 *  1. It tracks the camera from a `useFrame` (`drei/web/Html.js:219`). Under
 *     demand mode that hook only runs on rendered frames — which is fine
 *     BECAUSE every camera path in this app already calls `invalidate()`
 *     (FlyControls does it per movement frame, per look-drag, per wheel notch).
 *     The badge therefore tracks exactly as well as the render does. If a future
 *     camera path forgets to invalidate, the badge lagging is the symptom.
 *  2. It mounts its OWN `ReactDOM.createRoot` into a div appended beside the
 *     canvas (`:141`), and re-`render`s that root on every render of this
 *     component. That is a real cost per instance, which is the second reason
 *     this is single-selection only rather than one badge per selected object.
 *
 * DURING A ROTATION DRAG the text is written IMPERATIVELY from a
 * `useEditorStore.subscribe`, the same technique `ObjectGroup.tsx:318-329` uses
 * for the group matrix — so turning a table still costs zero React renders, here
 * and in the nested root.
 */
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { getCatalogEntry } from '../core/catalog/registry'
import { standingHeightAt } from '../core/layout/groundHeight'
import { cmToM } from '../core/space'
import { getVenuePack } from '../core/venuePacks'
import { displayName } from '../editor2d/ObjectNode'
import { useOverlayStore } from '../editor2d/overlayStore'
import { selectedTable } from '../state/selectors'
import { useEditorStore } from '../state/store'
import { isRotating, onRotatingChange } from './RotateHandle'
import { strings3d } from './strings3d'

/** Clear of the rotation ring, which already sits 2 cm over the table top. */
const LABEL_LIFT_CM = 26

function labelText(id: string): string {
  const obj = useEditorStore.getState().scene.objects[id]
  if (!obj) return ''
  const name = displayName(obj.name, obj.catalogId, obj.meta.number)
  if (isRotating()) {
    // the COMMITTED angle out of the store — `setRotation` runs `poseAllowed`
    // and can refuse, so the pointer's own angle would be a confident lie
    return `${name} · ${strings3d.bar.rotationValue(Math.round(obj.transform.rotation))}`
  }
  const seats = obj.seating?.count
  return seats ? `${name} · ${strings3d.selection.seatsLabel(seats)}` : name
}

export function TableLabel3D() {
  const groupRef = useRef<THREE.Group>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const invalidate = useThree((s) => s.invalidate)
  const id = useEditorStore((s) => selectedTable(s.scene, s.selection))
  const placing = useOverlayStore((s) => !!s.placing)

  // Height is a plain NUMBER selector so it survives the transient position
  // writes of a drag, exactly as `ObjectGroup`'s `baseElevation` does.
  const topCm = useEditorStore((s) => {
    const obj = id ? s.scene.objects[id] : undefined
    if (!obj) return 0
    const ground = standingHeightAt(
      getCatalogEntry(obj.catalogId),
      obj.transform.position,
      getVenuePack(s.scene.venue.venuePackId)?.restricted ?? [],
    )
    return ground + obj.transform.elevation + obj.size.height
  })

  /**
   * Follow the table without re-rendering — the drag path writes straight here.
   *
   * ⚠ ALL THREE components are written imperatively, including the one that
   * looks constant. Putting `y` in a `position` prop instead was wrong: React
   * rewrites the whole vector when `topCm` changes (a seat-count edit, a hang
   * slider), which resets x and z to 0 — and the position subscription does not
   * re-fire, because the table has not moved. The label would jump to the hall
   * origin and stay there.
   */
  useLayoutEffect(() => {
    if (!id) return
    const place = (position: { x: number; y: number } | undefined) => {
      const group = groupRef.current
      if (!position || !group) return
      group.position.set(cmToM(position.x), cmToM(topCm + LABEL_LIFT_CM), cmToM(position.y))
      invalidate()
    }
    place(useEditorStore.getState().scene.objects[id]?.transform.position)
    return useEditorStore.subscribe((s) => s.scene.objects[id]?.transform.position, place, {
      equalityFn: (a, b) => a?.x === b?.x && a?.y === b?.y,
    })
  }, [id, topCm, invalidate])

  /** …and the text, on rotation and on seat-count changes alike. */
  useLayoutEffect(() => {
    if (!id) return
    const write = () => {
      if (textRef.current) textRef.current.textContent = labelText(id)
    }
    write()
    const stopStore = useEditorStore.subscribe(
      (s) => {
        const obj = s.scene.objects[id]
        return `${obj?.name}|${obj?.meta.number}|${obj?.seating?.count}|${obj?.transform.rotation}`
      },
      write,
    )
    // NO setState here: the text is already written above, and a re-render would
    // re-`render()` drei's nested React root twice per rotation gesture for a
    // string this effect has just set by hand.
    const stopRotate = onRotatingChange(write)
    return () => {
      stopStore()
      stopRotate()
    }
  }, [id])

  if (!id || placing) return null

  return (
    <group ref={groupRef}>
      <Html center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
        <span
          ref={textRef}
          className="whitespace-nowrap rounded-full border border-line bg-panel/92 px-2.5 py-1 text-[13px] font-semibold text-ink shadow-sm backdrop-blur"
        />
      </Html>
    </group>
  )
}
